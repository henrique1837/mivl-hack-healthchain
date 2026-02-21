import { useState, useCallback } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, keccak256, toBytes } from 'viem'
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

const STEPS = ['Generate Secret', 'Lock Funds', 'Notify Provider', 'Done']

export default function AccessRequestFlow({ provider, requesterAccounts, onBack }) {
    const { sendEncryptedDM, pubkey: myPubkey, privKey } = useNostr()
    const { writeContractAsync } = useWriteContract()

    const [step, setStep] = useState(0) // 0..3
    const [amount, setAmount] = useState('0.001')
    const [secret, setSecret] = useState(null)
    const [hashlock, setHashlock] = useState(null)
    const [lockId, setLockId] = useState(null)
    const [txHash, setTxHash] = useState(null)
    const [error, setError] = useState(null)
    const [isLoading, setIsLoading] = useState(false)

    const npub = provider?.pubkey ? nip19.npubEncode(provider.pubkey) : '—'
    const records = provider?.healthRecords ?? []

    // Step 0 → generate secret + hashlock (requester is payer)
    const handleGenerateSecret = async () => {
        setIsLoading(true)
        setError(null)
        try {
            // Note: in true HTLC, PROVIDER generates the secret.
            // For UX simplicity here, requester picks an amount and generates secret;
            // the provider's published hashlock would be used if present.
            // We use provider's published hashlock if available, else generate one.
            let hl = provider?.data_hashlock
            let sec = null
            if (!hl) {
                const gen = await generateSecretAndHash()
                sec = gen.secret
                hl = gen.hashlock
            }
            setSecret(sec)
            setHashlock(hl)
            setStep(1)
        } catch (e) {
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }

    // Step 1 → lock EVM funds in HTLC
    const handleLockFunds = async () => {
        setIsLoading(true)
        setError(null)
        try {
            const providerEVM = provider?.walletAddress
            if (!providerEVM) throw new Error("Provider has no registered EVM address.")
            if (!hashlock) throw new Error("No hashlock available.")

            const hash = await writeContractAsync({
                address: HTLC_CONTRACT.address,
                abi: HTLC_CONTRACT.abi,
                functionName: 'lock',
                args: [providerEVM, hashlock, BigInt(TIMELOCK_24H)],
                value: parseEther(amount),
            })
            setTxHash(hash)
            // In a real deployment we'd parse the event to get lockId.
            // For now we derive it optimistically from the tx hash.
            const derivedLockId = keccak256(toBytes(hash))
            setLockId(derivedLockId)
            setStep(2)
        } catch (e) {
            console.error(e)
            setError(e.message || 'Transaction failed')
        } finally {
            setIsLoading(false)
        }
    }

    // Step 2 → Nostr DM to provider
    const handleNotifyProvider = async () => {
        if (!provider?.pubkey) { setError("Provider Nostr pubkey unknown."); return }
        setIsLoading(true)
        setError(null)
        try {
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
                lockId || 'htlc-request',
                null,
                null
            )
            setStep(3)
        } catch (e) {
            setError(e.message || 'Failed to send DM')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            {/* Back */}
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
                    <div key={i} className="flex items-center gap-1 flex-1">
                        <div className={`flex-1 h-1.5 rounded-full transition-all ${i <= step ? 'bg-primary' : 'bg-white/10'}`} />
                        {i < STEPS.length - 1 && <div className={`w-1.5 h-1.5 rounded-full ${i < step ? 'bg-primary' : 'bg-white/10'}`} />}
                    </div>
                ))}
            </div>
            <p className="text-xs text-center text-white/40 uppercase tracking-widest">{STEPS[step]}</p>

            {/* Chain guard — enforce MIDL network for on-chain steps */}
            <ChainGuard>
                <div className="space-y-4">
                    {step === 0 && (
                        <div className="space-y-4">
                            <div className="p-4 bg-primary/5 border border-primary/10 rounded-xl text-xs text-white/50 space-y-1">
                                <p>🔐 You will lock EVM funds as a bond for data access.</p>
                                <p>📡 The provider will see your request via Nostr DM.</p>
                                <p>🔓 Funds are refundable after 24h if provider doesn't respond.</p>
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

                            {!provider?.data_hashlock && (
                                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-xs text-yellow-400">
                                    ⚠️ This provider hasn't published a hashlock yet. A temporary one will be generated — the provider must share their secret manually to complete the exchange.
                                </div>
                            )}

                            <button onClick={handleGenerateSecret} disabled={isLoading} className="w-full btn-primary disabled:opacity-40">
                                {isLoading ? 'Generating...' : '🔑 Generate Secret & Continue'}
                            </button>
                        </div>
                    )}

                    {step === 1 && (
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

                            <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-xl text-xs text-white/40">
                                ⚠️ Save your secret if you generated it. You may need it for dispute resolution.
                            </div>

                            <button onClick={handleLockFunds} disabled={isLoading} className="w-full btn-primary disabled:opacity-40">
                                {isLoading ? 'Locking funds...' : `🔒 Lock ${amount} EVM on MIDL`}
                            </button>
                        </div>
                    )}

                    {step === 2 && (
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

                    {step === 3 && (
                        <div className="space-y-4 text-center">
                            <div className="text-5xl">🎉</div>
                            <p className="font-bold text-white">Request Sent!</p>
                            <p className="text-xs text-white/40 max-w-xs mx-auto">
                                The provider has been notified. Once they approve and share the encrypted data, you'll see it in your <strong>Incoming Requests</strong> tab with the decryption secret revealed atomically when they claim the funds.
                            </p>
                            <button onClick={onBack} className="btn-primary text-sm">← Back to Users</button>
                        </div>
                    )}
                </div>
            </ChainGuard>

            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">{error}</div>
            )}
        </div>
    )
}
