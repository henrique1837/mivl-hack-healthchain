import { useState, useEffect } from 'react'
import { encodeFunctionData, parseEther } from 'viem'
import { usePublicClient } from 'wagmi'
import {
    useAddTxIntention,
    useFinalizeBTCTransaction,
    useSignIntention,
} from "@midl/executor-react";
import { useWaitForTransaction } from "@midl/react";
import { nip19 } from 'nostr-tools'
import { useNostr } from '../contexts/NostrContext'
import { HTLC_CONTRACT } from '../utils/DataShareHTLC'
import ChainGuard from './ChainGuard'

const TIMELOCK_24H = 86400 // seconds

// Derive a hashlock from a random secret (SHA-256 via Web Crypto → bytes32)
async function generateSecretAndHash() {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    const hashBuffer = await crypto.subtle.digest('SHA-256', secret)
    const secretHex = '0x' + Array.from(secret).map(b => b.toString(16).padStart(2, '0')).join('')
    const hashHex = '0x' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
    return { secret: secretHex, hashlock: hashHex }
}

const STEPS = ['Generate Secret', 'Prepare Lock', 'Finalize BTC Tx', 'Sign Intentions', 'Broadcast', 'Notify Provider', 'Done']

export default function AccessRequestFlow({ provider, requesterAccounts, onBack }) {
    const { sendEncryptedDM, pubkey: myPubkey, privKey } = useNostr()
    const publicClient = usePublicClient()

    const { addTxIntention, txIntentions, error: addIntentionError } = useAddTxIntention()
    const { finalizeBTCTransaction, data: btcTxData, error: finalizeBTCError, isPending: isFinalizingBTC } = useFinalizeBTCTransaction()
    const { signIntentionAsync } = useSignIntention()

    const [step, setStep] = useState(0) // matches STEPS array indices
    const [amount, setAmount] = useState('0.001')
    const [secret, setSecret] = useState(null)
    const [hashlock, setHashlock] = useState(null)
    const [txHash, setTxHash] = useState(null)
    const [error, setError] = useState(null)
    const [isLoading, setIsLoading] = useState(false)

    const npub = provider?.pubkey ? nip19.npubEncode(provider.pubkey) : '—'
    const records = provider?.healthRecords ?? []
    // Provider's EVM address from their Nostr profile (saved via useEVMAddress() when they connected)
    const providerEVM = provider?.walletAddress

    const { waitForTransaction } = useWaitForTransaction({
        mutation: {
            onSuccess: () => {
                setIsLoading(false)
                setStep(5) // Move to Notify Provider step
            },
            onError: (err) => {
                setIsLoading(false)
                setError("Transaction failed: " + err.message)
            }
        }
    })

    // Reactively advance step when btcTxData arrives (wallet popup completes)
    useEffect(() => {
        if (btcTxData && step === 2) {
            setStep(3) // BTC tx finalized — now ready to sign
        }
    }, [btcTxData]) // eslint-disable-line

    // Step 0 → generate secret + hashlock
    const handleGenerateSecret = async () => {
        setIsLoading(true)
        setError(null)
        try {
            let hl = provider?.data_hashlock
            let sec = null
            if (!hl) {
                const gen = await generateSecretAndHash()
                sec = gen.secret
                hl = gen.hashlock
            }
            setSecret(sec)
            setHashlock(hl)
            setStep(1) // Move to Prepare Lock (addIntention)
        } catch (e) {
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }

    // MIDL Step 1: Add Intention
    const handleAddIntention = () => {
        setError(null)
        try {
            if (!providerEVM) throw new Error("Provider has no EVM address saved. Ask them to reconnect their wallet to update their profile.")
            if (!providerEVM.startsWith('0x') || providerEVM.length !== 42) {
                throw new Error(`Provider EVM address invalid: "${providerEVM}". Ask them to reconnect their wallet.`)
            }
            if (!hashlock) throw new Error("No hashlock available.")

            addTxIntention({
                reset: true,
                intention: {
                    evmTransaction: {
                        to: HTLC_CONTRACT.address,
                        value: parseEther(amount), // Pass bigint directly, viem/MIDL SDK will hex-encode it correctly
                        data: encodeFunctionData({
                            abi: HTLC_CONTRACT.abi,
                            functionName: 'lock',
                            args: [providerEVM, hashlock, BigInt(TIMELOCK_24H)],
                        }),
                    },
                },
            })
            setStep(2)
        } catch (e) {
            console.error(e)
            setError(e.message)
        }
    }

    // MIDL Step 2: Finalize BTC Tx — opens wallet popup; btcTxData populates asynchronously
    const handleFinalizeBTC = () => {
        console.log('[MIDL] finalizeBTCTransaction called, txIntentions:', txIntentions)
        setError(null)
        finalizeBTCTransaction()
        // No try/catch — MIDL handles errors internally; btcTxData populates when wallet popup completes
    }

    // MIDL Step 3: Sign Intentions
    const handleSignIntentions = async () => {
        if (!btcTxData) {
            setError("Please finalize BTC transaction first")
            return
        }
        setIsLoading(true)
        setError(null)
        try {
            for (const intention of txIntentions) {
                await signIntentionAsync({
                    intention,
                    txId: btcTxData.tx.id,
                })
            }
            // step advances to 4 via useEffect when signedEvmTransaction is set
        } catch (e) {
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }

    // MIDL Step 4: Broadcast
    const handleBroadcast = async () => {
        if (!btcTxData) {
            setError("Please finalize BTC transaction first")
            return
        }
        setIsLoading(true)
        setError(null)
        try {
            await publicClient?.sendBTCTransactions({
                serializedTransactions: txIntentions.map(it => it.signedEvmTransaction),
                btcTransaction: btcTxData.tx.hex,
            })
            // Optimistic lockId derivation (txId)
            setTxHash(btcTxData.tx.id)
            waitForTransaction({ txId: btcTxData.tx.id })
            // Waiting... step 5 triggers on success
        } catch (e) {
            console.error(e)
            setError(e.message || 'Broadcast failed')
            setIsLoading(false)
        }
    }

    // Step 5 → Nostr DM to provider
    const handleNotifyProvider = async () => {
        if (!provider?.pubkey) { setError("Provider Nostr pubkey unknown."); return }
        setIsLoading(true)
        setError(null)
        try {
            // We use the btcTxData.tx.id as the lockId optimistically
            const lockId = txHash || 'htlc-request'

            const message = JSON.stringify({
                type: 'data_access_request',
                lockId,
                txHash,
                hashlock,
                amount,
                requesterPubkey: myPubkey,
                requesterEVM: requesterAccounts?.[0]?.evmAddress,
                timestamp: Math.floor(Date.now() / 1000),
            })
            await sendEncryptedDM(
                provider.pubkey,
                message,
                lockId,
                null,
                null
            )

            // Save backup self-DM
            const backupMessage = JSON.stringify({
                type: 'outgoing_access_request',
                lockId,
                txHash,
                hashlock,
                secret,
                amount,
                providerPubkey: provider.pubkey,
                timestamp: Math.floor(Date.now() / 1000),
            })
            await sendEncryptedDM(
                myPubkey,
                backupMessage,
                lockId,
                null,
                null
            )

            setStep(6) // Done
        } catch (e) {
            setError(e.message || 'Failed to send DM')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            <button onClick={onBack} className="flex items-center gap-2 text-xs text-white/40 hover:text-white transition-colors">
                ← Back to Users
            </button>

            {/* Provider card */}
            <div className="flex items-center gap-4 p-4 bg-black/20 border border-white/5 rounded-2xl">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center text-xl font-bold text-white">
                    {provider?.name?.[0]?.toUpperCase() || '👤'}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white text-sm">{provider?.name || 'Anonymous'}</p>
                    <p className="text-xs text-white/30 font-mono">{npub.slice(0, 28)}…</p>
                </div>
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-lg border border-primary/20 font-bold">
                    {records.length} records
                </span>
            </div>

            {/* Step progress */}
            <div className="flex items-center gap-1">
                {STEPS.map((label, i) => (
                    <div key={i} className="flex items-center gap-0.5 flex-1">
                        <div className={`flex-1 h-1.5 rounded-full transition-all ${i <= step ? 'bg-primary' : 'bg-white/10'}`} />
                    </div>
                ))}
            </div>
            <p className="text-[10px] text-center text-white/40 uppercase tracking-widest">{STEPS[step]}</p>

            <ChainGuard>
                <div className="space-y-4">
                    {step === 0 && (
                        <div className="space-y-4">
                            <div className="p-4 bg-primary/5 border border-primary/10 rounded-xl text-xs text-white/50 space-y-1">
                                <p>🔐 You will lock EVM funds as a bond for data access.</p>
                                <p>📡 The provider will see your request via Nostr DM.</p>
                            </div>
                            <div>
                                <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">
                                    Amount to Lock (EVM units)
                                </label>
                                <input
                                    type="number"
                                    step="0.0001"
                                    min="0.0001"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50"
                                />
                            </div>
                            <button onClick={handleGenerateSecret} disabled={isLoading} className="w-full btn-primary disabled:opacity-40">
                                {isLoading ? 'Generating...' : '🔑 Generate Secret'}
                            </button>
                        </div>
                    )}

                    {(step >= 1 && step <= 4) && (
                        <div className="space-y-4">
                            <div className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-2">
                                <div>
                                    <span className="text-[10px] text-white/30 uppercase block mb-0.5">Hashlock</span>
                                    <code className="text-xs text-primary break-all">{hashlock}</code>
                                </div>
                                {secret && (
                                    <div>
                                        <span className="text-[10px] text-white/30 uppercase block mb-0.5">Your Secret (keep private!)</span>
                                        <code className="text-xs text-accent break-all">{secret}</code>
                                    </div>
                                )}
                            </div>

                            <div className="p-4 glass bg-primary/5 space-y-3 border-primary/20 rounded-xl">
                                {/* Provider EVM address status */}
                                {providerEVM && providerEVM.startsWith('0x') && providerEVM.length === 42 ? (
                                    <div className="text-[10px] text-green-400/70 bg-green-500/5 border border-green-500/20 rounded-lg px-3 py-2">
                                        ✅ Provider EVM: <code className="font-mono">{providerEVM.slice(0, 10)}…{providerEVM.slice(-6)}</code>
                                    </div>
                                ) : (
                                    <div className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                        ⚠️ Provider has no saved EVM address. Ask them to reconnect their wallet to update their profile, then refresh.
                                    </div>
                                )}
                                <p className="text-xs text-center text-white/50">You are about to lock <strong className="text-white">{amount} EVM</strong> on-chain. Follow the MIDL executor flow.</p>

                                {/* Step 1: Always clickable (reset:true clears old state) */}
                                <button
                                    onClick={handleAddIntention}
                                    disabled={isLoading}
                                    className={`w-full py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-30 ${txIntentions.length > 0
                                        ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                                        }`}
                                >
                                    {txIntentions.length > 0 ? '✓ 1. Intention Prepared — Click to Reset' : '1. Prepare Transaction Intention'}
                                </button>

                                {/* Step 2: Enabled once we have an intention */}
                                <button
                                    onClick={handleFinalizeBTC}
                                    disabled={txIntentions.length === 0 || isFinalizingBTC}
                                    className={`w-full py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-30 ${btcTxData
                                        ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                                        }`}
                                >
                                    {isFinalizingBTC ? 'Opening wallet popup...' : btcTxData ? '✓ 2. BTC Gas Finalized' : '2. Calculate Gas & Finalize BTC'}
                                </button>

                                {/* Step 3: Enabled once btcTxData is available */}
                                <button
                                    onClick={handleSignIntentions}
                                    disabled={!btcTxData || isLoading}
                                    className={`w-full py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-30 ${txIntentions[0]?.signedEvmTransaction
                                        ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                                        }`}
                                >
                                    {isLoading ? 'Signing...' : txIntentions[0]?.signedEvmTransaction ? '✓ 3. Intentions Signed' : '3. Sign All Intentions'}
                                </button>

                                {/* Step 4: Enabled once intentions are signed */}
                                <button
                                    onClick={handleBroadcast}
                                    disabled={!txIntentions[0]?.signedEvmTransaction || isLoading}
                                    className="w-full py-3 rounded-xl bg-accent text-black font-extrabold text-sm hover:brightness-110 disabled:opacity-30 shadow-[0_0_20px_oklch(0.8_0.15_150_/_0.3)]"
                                >
                                    {isLoading ? 'Broadcasting & Waiting...' : '4. Broadcast to Network'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 5 && (
                        <div className="space-y-4">
                            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 space-y-1">
                                <p className="text-xs text-green-400 font-bold">✅ Funds locked on-chain!</p>
                                {txHash && <code className="text-[10px] text-white/30 break-all block">{txHash}</code>}
                            </div>
                            <p className="text-xs text-white/50">
                                Now notify <span className="text-white font-semibold">{provider?.name || 'provider'}</span> via encrypted Nostr DM that the funds are locked.
                            </p>
                            <button onClick={handleNotifyProvider} disabled={isLoading} className="w-full btn-primary disabled:opacity-40">
                                {isLoading ? 'Sending DM...' : '📨 Send Access Request via Nostr'}
                            </button>
                        </div>
                    )}

                    {step === 6 && (
                        <div className="space-y-4 text-center">
                            <div className="text-5xl">🎉</div>
                            <p className="font-bold text-white">Request Sent!</p>
                            <p className="text-xs text-white/40 max-w-xs mx-auto">
                                The provider has been notified. You can track this in the <strong>Requested Data</strong> tab.
                            </p>
                            <button onClick={onBack} className="btn-primary text-sm">← Back to Users</button>
                        </div>
                    )}
                </div>
            </ChainGuard>

            {(error || finalizeBTCError || addIntentionError) && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs space-y-1">
                    {error && <p>{error}</p>}
                    {finalizeBTCError && <p>Finalize BTC error: {finalizeBTCError?.message || String(finalizeBTCError)}</p>}
                    {addIntentionError && <p>Add intention error: {addIntentionError?.message || String(addIntentionError)}</p>}
                </div>
            )}
        </div>
    )
}
