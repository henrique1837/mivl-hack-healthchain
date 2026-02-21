import { useState, useEffect, useCallback } from 'react'
import { useReadContract } from 'wagmi'
import { encodeFunctionData } from 'viem'
import { usePublicClient } from 'wagmi'
import {
    useAddTxIntention,
    useFinalizeBTCTransaction,
    useSignIntention
} from "@midl/executor-react";
import { useWaitForTransaction } from "@midl/react";
import { nip19 } from 'nostr-tools'
import { useNostr } from '../contexts/NostrContext'
import { HTLC_CONTRACT, encryptWithSecret } from '../utils/DataShareHTLC'
import ChainGuard from './ChainGuard'

function IncomingRequestCard({ request, privKey, pubkey, profile }) {
    const { sendEncryptedDM } = useNostr()
    const publicClient = usePublicClient()

    // MIDL Executor hooks
    const { addTxIntention, txIntentions } = useAddTxIntention()
    const { finalizeBTCTransaction, data: btcTxData } = useFinalizeBTCTransaction()
    const { signIntentionAsync } = useSignIntention()

    const [status, setStatus] = useState('pending') // pending | intent | final | sign | broadcast | done | error
    const [error, setError] = useState(null)
    const [sharedSecret, setSharedSecret] = useState(null) // the preimage the provider used
    const [isLoading, setIsLoading] = useState(false)

    // Verify the HTLC lock on-chain
    const { data: lockData } = useReadContract({
        address: HTLC_CONTRACT.address,
        abi: HTLC_CONTRACT.abi,
        functionName: 'getLock',
        args: [request.lockId],
        query: { enabled: !!request.lockId && request.lockId !== 'htlc-request' }
    })

    const { waitForTransaction } = useWaitForTransaction({
        mutation: {
            onSuccess: () => {
                setIsLoading(false)
                setStatus('done')
            },
            onError: (err) => {
                setIsLoading(false)
                setError("Transaction failed: " + err.message)
                setStatus('error')
            }
        }
    })

    // timelock=0 means the slot is empty (lock not found for this lockId on-chain)
    const lockExists = lockData && Number(lockData.timelock) > 0
    const isLockValid = lockExists && !lockData.claimed && !lockData.refunded
    const lockExpiry = lockExists ? new Date(Number(lockData.timelock) * 1000) : null

    // Reactively advance status when btcTxData arrives (wallet popup completes)
    useEffect(() => {
        if (btcTxData && status === 'final') setStatus('sign')
    }, [btcTxData]) // eslint-disable-line

    // Reactively advance status when intentions get signed
    useEffect(() => {
        if (txIntentions[0]?.signedEvmTransaction && status === 'sign') setStatus('broadcast')
    }, [txIntentions]) // eslint-disable-line

    // 1. Prepare Claim Intention
    const handlePrepareClaim = async () => {
        if (!profile?.healthRecords?.length) {
            setError("No health records to share")
            return
        }
        if (!request.secret) {
            setError("No secret provided by the requester. Cannot claim HTLC funds.")
            return
        }
        setStatus('intent')
        setError(null)
        try {
            const secretHex = request.secret
            setSharedSecret(secretHex)

            // Prepare the on-chain claim intention
            addTxIntention({
                reset: true,
                intention: {
                    evmTransaction: {
                        to: HTLC_CONTRACT.address,
                        data: encodeFunctionData({
                            abi: HTLC_CONTRACT.abi,
                            functionName: 'claim',
                            args: [request.lockId, secretHex],
                        }),
                    },
                },
            })
            setStatus('final')
        } catch (e) {
            console.error(e)
            setError(e.message || 'Failed to prepare claim')
        }
    }

    // 2. Finalize BTC — fire-and-forget; status advances via useEffect when btcTxData arrives
    const handleFinalizeBTC = () => {
        console.log('[IncomingRequests] finalizeBTCTransaction called, txIntentions:', txIntentions.length)
        setError(null)
        try {
            finalizeBTCTransaction()
            // Status advances to 'sign' via useEffect when btcTxData populates
        } catch (e) {
            console.error('[IncomingRequests] finalizeBTC error:', e)
            setError(e.message)
        }
    }

    // 3. Sign Intentions
    const handleSignIntentions = async () => {
        if (!btcTxData) {
            setError('Please finalize BTC transaction first')
            return
        }
        console.log('[IncomingRequests] Signing intentions, btcTxData.tx.id:', btcTxData.tx.id)
        setIsLoading(true)
        setError(null)
        try {
            for (const intention of txIntentions) {
                console.log('[IncomingRequests] Signing intention:', { hasSignedTx: !!intention.signedEvmTransaction })
                await signIntentionAsync({
                    intention,
                    txId: btcTxData.tx.id,
                })
            }
            console.log('[IncomingRequests] All intentions signed')
            setStatus('broadcast')
        } catch (e) {
            console.error('[IncomingRequests] Sign error:', e)
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }

    // 4. Broadcast Claim AND send encrypted data Nostr DM
    const handleBroadcastAndShare = async () => {
        if (!btcTxData || !sharedSecret) {
            setError('Missing transaction data or shared secret')
            return
        }
        console.log('[IncomingRequests] Broadcasting claim, btcTxData.tx.id:', btcTxData.tx.id)
        console.log('[IncomingRequests] Intentions signed:', txIntentions.map(i => !!i.signedEvmTransaction))
        setIsLoading(true)
        setError(null)
        try {
            // A. Broadcast claim tx
            const claimHashes = await publicClient?.sendBTCTransactions({
                serializedTransactions: txIntentions.map(it => /** @type {`0x${string}`} */(it.signedEvmTransaction)),
                btcTransaction: btcTxData.tx.hex,
            })
            console.log('[IncomingRequests] Claim broadcast hashes:', claimHashes)
            waitForTransaction({ txId: btcTxData.tx.id })

            // B. Send encrypted data over Nostr
            const encryptedPayload = await encryptWithSecret(
                { healthRecords: profile.healthRecords, pubkey },
                sharedSecret
            )
            const dmPayload = JSON.stringify({
                type: 'data_access_response',
                lockId: request.lockId,
                encryptedPayload,
            })
            console.log('[IncomingRequests] Sending encrypted Nostr DM to requester:', request.requesterPubkey)
            await sendEncryptedDM(request.requesterPubkey, dmPayload, request.lockId, true, null)

            setStatus('claiming')
        } catch (e) {
            console.error('[IncomingRequests] Broadcast/share error:', e)
            setError(e.message || 'Failed to share data and claim')
            setIsLoading(false)
            setStatus('error')
        }
    }

    const npub = request.requesterPubkey ? nip19.npubEncode(request.requesterPubkey) : '—'

    return (
        <div className="bg-black/20 border border-white/5 rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-white">Access Request</p>
                    <p className="text-xs text-white/30 font-mono mt-0.5">{npub.slice(0, 24)}…</p>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase border ${status === 'done' ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : status === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                    }`}>
                    {status}
                </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-black/30 rounded-xl p-3">
                    <span className="text-white/30 uppercase text-[10px] block mb-0.5">Amount Locked</span>
                    <span className="text-white font-bold">{request.amount} EVM</span>
                </div>
                <div className="bg-black/30 rounded-xl p-3">
                    <span className="text-white/30 uppercase text-[10px] block mb-0.5">Lock Expires</span>
                    <span className="text-white font-bold">{lockExpiry ? lockExpiry.toLocaleDateString() : '—'}</span>
                </div>
            </div>

            {lockData && (
                <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${isLockValid ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                    : lockExists ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                        : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                    }`}>
                    {isLockValid ? '✅ Funds verified on-chain'
                        : lockExists ? '❌ Lock already claimed or refunded'
                            : '⚠️ Lock not found on-chain (lockId may be wrong — EVM tx may not be confirmed yet)'}
                </div>
            )}

            {status === 'done' && (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-green-400">
                    ✅ Data shared & funds claimed atomically!
                </div>
            )}

            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{error}</div>
            )}

            {(!['claiming', 'done', 'error'].includes(status) && isLockValid) && (
                <ChainGuard>
                    <div className="p-4 glass bg-primary/5 space-y-3 border-primary/20 rounded-xl">
                        <button onClick={handlePrepareClaim} disabled={status !== 'pending' || txIntentions.length > 0} className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-30">
                            1. Prepare Claim Intention {status !== 'pending' && '✓'}
                        </button>

                        <button onClick={handleFinalizeBTC} disabled={status !== 'final'} className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-30">
                            2. Calculate Gas & Finalize BTC {status !== 'pending' && status !== 'final' && '✓'}
                        </button>

                        <button onClick={handleSignIntentions} disabled={status !== 'sign' || isLoading} className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-30">
                            {isLoading && status === 'sign' ? 'Signing...' : `3. Sign Claim Intentions ${status === 'broadcast' ? '✓' : ''}`}
                        </button>

                        <button onClick={handleBroadcastAndShare} disabled={status !== 'broadcast' || isLoading} className="w-full py-3 rounded-xl bg-accent text-black font-extrabold text-sm hover:brightness-110 disabled:opacity-30 shadow-[0_0_20px_oklch(0.8_0.15_150_/_0.3)]">
                            {isLoading && status === 'broadcast' ? 'Broadcasting & Waiting...' : '4. Broadcast Claim & Send Data'}
                        </button>
                    </div>
                </ChainGuard>
            )}

            {(status === 'claiming') && (
                <div className="flex items-center justify-center gap-2 py-3 text-white/50 text-sm">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Claiming funds on-chain...
                </div>
            )}
        </div>
    )
}

export default function IncomingRequests({ mineProfile }) {
    const { pubkey, privKey, encryptedMessages, subscribeToDMs, decryptDM } = useNostr()
    const [requests, setRequests] = useState([])
    const [isLoading, setIsLoading] = useState(true)

    const loadRequests = useCallback(async () => {
        if (!pubkey) return
        setIsLoading(true)
        try {
            await subscribeToDMs('healthchain-v0-datashare', null)
        } finally {
            setIsLoading(false)
        }
    }, [pubkey, subscribeToDMs])

    useEffect(() => { loadRequests() }, [loadRequests])

    // Parse decrypted DMs into request objects
    useEffect(() => {
        const parseMessages = async () => {
            const parsed = []
            for (const msg of encryptedMessages) {
                try {
                    const decrypted = await decryptDM(msg)
                    if (!decrypted) continue
                    const data = JSON.parse(decrypted)
                    if (data.type === 'data_access_request') {
                        parsed.push({
                            ...data,
                            msgId: msg.id,
                            created_at: msg.created_at,
                        })
                    }
                } catch (e) { /* skip malformed */ }
            }
            setRequests(parsed)
        }
        if (encryptedMessages?.length) parseMessages()
    }, [encryptedMessages, decryptDM])

    if (!pubkey) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <span className="text-4xl">🔐</span>
                <p className="text-white/40 text-sm">Connect wallet to see incoming requests</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-xs text-white/30 uppercase tracking-widest">
                    {isLoading ? 'Loading...' : `${requests.length} pending request${requests.length !== 1 ? 's' : ''}`}
                </span>
                <button onClick={loadRequests} className="text-xs text-white/30 hover:text-white transition-colors px-3 py-1 rounded-lg hover:bg-white/5">
                    ↻ Refresh
                </button>
            </div>

            {requests.length === 0 && !isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-white/5 rounded-2xl text-center gap-3">
                    <span className="text-4xl">📭</span>
                    <p className="text-white/30 text-sm">No incoming access requests yet.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {requests.map(req => (
                        <IncomingRequestCard
                            key={req.msgId}
                            request={req}
                            privKey={privKey}
                            pubkey={pubkey}
                            profile={mineProfile}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
