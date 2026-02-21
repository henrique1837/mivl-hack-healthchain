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
import { useNostr, NOSTR_APP_TAG, NOSTR_SHARING_DATA_OP_TAG } from '../contexts/NostrContext'
import { HTLC_CONTRACT, decryptWithSecret } from '../utils/DataShareHTLC'
import { decryptData as decryptHealthData } from './HealthDataUpload'
import ChainGuard from './ChainGuard'

function OutgoingRequestCard({ request }) {
    const publicClient = usePublicClient()

    // MIDL Executor hooks
    const { addTxIntention, txIntentions } = useAddTxIntention()
    const { finalizeBTCTransactionAsync, isPending: isFinalizePending, data: btcTxData } = useFinalizeBTCTransaction()
    const { signIntentionAsync } = useSignIntention()

    const [status, setStatus] = useState('pending') // pending | intent | final | sign | broadcast | refunding | done | error
    const [error, setError] = useState(null)
    const [isLoading, setIsLoading] = useState(false)
    const [decryptedData, setDecryptedData] = useState(null)

    const { pubkey, pool, RELAYS, decryptDM } = useNostr()
    const [isFetchingData, setIsFetchingData] = useState(false)

    // Dynamically fetch and decrypt the payload from the provider when clicking the button
    const handleFetchSharedData = async () => {
        setIsFetchingData(true)
        setError(null)
        console.log('[OutgoingRequests] Fetching shared data for lockId:', request.lockId)
        try {
            // Find the provider's reply which is sent TO us (#p: pubkey)
            // with OP tag NOSTR_SHARING_DATA_OP_TAG and C tag request.lockId
            const filters = {
                kinds: [4],
                '#p': [pubkey],
                '#A': [NOSTR_APP_TAG],
                '#O': [NOSTR_SHARING_DATA_OP_TAG]
            };

            const rawEvents = await pool.querySync(RELAYS, filters);
            console.log(`[OutgoingRequests] Found ${rawEvents.length} total NOSTR_SHARING_DATA_OP_TAG events directed to us.`);

            const events = rawEvents.filter(e => {
                const cTag = e.tags.find(t => t[0] === 'C')?.[1];
                if (!cTag) return false;
                return cTag.toLowerCase() === request.lockId.toLowerCase();
            });
            console.log(`[OutgoingRequests] Found ${events.length} events matching lockId: ${request.lockId}`);
            if (rawEvents.length > 0 && events.length === 0) {
                console.log('[OutgoingRequests] Example C tags from the events:', rawEvents.slice(0, 3).map(e => e.tags.find(t => t[0] === 'C')?.[1]));
            }

            if (events.length === 0) {
                setError(`Provider has not responded with data yet (Found ${rawEvents.length} other replies).`);
                setIsFetchingData(false);
                return;
            }

            // We expect at least one, take the newest
            const sorted = events.sort((a, b) => b.created_at - a.created_at);
            const responseMsg = sorted[0];

            console.log('[OutgoingRequests] Decrypting DM payload from provider...')
            const decryptedString = await decryptDM(responseMsg);
            if (!decryptedString) throw new Error('Failed to decrypt DM with Nostr keys');

            const data = JSON.parse(decryptedString);
            console.log('[OutgoingRequests] DM content parsed successfully', data.type);

            if (data.type !== 'data_access_response' || !data.encryptedPayload) {
                throw new Error('Invalid response format from provider');
            }

            // Decrypt the actual health records payload using the HTLC secret
            console.log('[OutgoingRequests] Decrypting health records array with HTLC secret...')
            const decryptedRecordsStr = await decryptWithSecret(data.encryptedPayload, request.secret);
            const recordsJson = JSON.parse(decryptedRecordsStr);
            const healthRecords = recordsJson.healthRecords || [];
            const providerPubkey = recordsJson.pubkey;
            console.log(`[OutgoingRequests] Successfully decrypted ${healthRecords.length} records! Loading full payloads...`);

            // Now that we have the CIDs, we must fetch the actual encrypted payloads from Nostr
            // (Simulating IPFS by fetching the provider's kind 1 storage events tagged with the CID)
            const fullRecords = await Promise.all(healthRecords.map(async (rec) => {
                try {
                    const cidFilter = {
                        kinds: [1],
                        authors: [providerPubkey],
                        '#A': ['healthchain-v1-storage'],
                        '#C': [rec.cid]
                    };
                    const payloadEvents = await pool.querySync(RELAYS, cidFilter);

                    if (payloadEvents.length === 0) {
                        return { ...rec, error: 'Raw payload not found on Nostr (IPFS simulation missing). Was the record created before this update?' };
                    }

                    const payloadEvent = payloadEvents.sort((a, b) => b.created_at - a.created_at)[0];

                    // The payload is AES-GCM encrypted. The key is derived from the provider's pubkey.
                    const decryptedRecordPayload = await decryptHealthData(payloadEvent.content, providerPubkey);

                    return { ...rec, fullData: decryptedRecordPayload };
                } catch (err) {
                    console.error('Error fetching/decrypting record', rec.cid, err);
                    return { ...rec, error: 'Failed to load or decrypt' };
                }
            }));

            setDecryptedData({ ...recordsJson, healthRecords: fullRecords });
            setError(null);
        } catch (e) {
            console.error('[OutgoingRequests] handleFetchSharedData error:', e);
            setError(e.message || 'Failed to fetch and decrypt shared data');
        } finally {
            setIsFetchingData(false)
        }
    }

    // Verify the HTLC lock on-chain
    const { data: lockData, refetch } = useReadContract({
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
                refetch()
                setStatus('done')
            },
            onError: (err) => {
                setIsLoading(false)
                setError("Transaction failed: " + err.message)
                setStatus('error')
            }
        }
    })

    const lockExists = lockData && Number(lockData.timelock) > 0
    const isLockActive = lockExists && !lockData.claimed && !lockData.refunded
    const lockExpiry = lockExists ? new Date(Number(lockData.timelock) * 1000) : null
    const canRefund = isLockActive && Date.now() > Number(lockData.timelock) * 1000

    // 1. Prepare Refund Intention
    const handlePrepareRefund = () => {
        setStatus('intent')
        setError(null)
        try {
            addTxIntention({
                reset: true,
                intention: {
                    evmTransaction: {
                        to: HTLC_CONTRACT.address,
                        data: encodeFunctionData({
                            abi: HTLC_CONTRACT.abi,
                            functionName: 'refund',
                            args: [request.lockId],
                        }),
                    },
                },
            })
            setStatus('final')
        } catch (e) {
            console.error(e)
            setError(e.message || 'Failed to prepare refund')
        }
    }

    // 2. Finalize BTC
    const handleFinalizeBTC = async () => {
        console.log('[OutgoingRequests] finalizeBTCTransactionAsync called, txIntentions:', txIntentions.length)
        setError(null)
        try {
            const result = await finalizeBTCTransactionAsync()
            console.log('[OutgoingRequests] finalizeBTC result:', result?.tx?.id)
            setStatus('sign')
        } catch (e) {
            console.error('[OutgoingRequests] finalizeBTC error:', e)
            setError(e.message || 'Failed to finalize BTC transaction')
        }
    }

    // 3. Sign Intentions
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
            setStatus('broadcast')
        } catch (e) {
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }

    // 4. Broadcast
    const handleBroadcast = async () => {
        if (!btcTxData) {
            setError('Missing transaction data')
            return
        }
        console.log('[OutgoingRequests] Broadcasting refund, btcTxData.tx.id:', btcTxData.tx.id)
        console.log('[OutgoingRequests] Intentions signed:', txIntentions.map(i => !!i.signedEvmTransaction))
        setIsLoading(true)
        setError(null)
        try {
            const refundHashes = await publicClient?.sendBTCTransactions({
                serializedTransactions: txIntentions.map(it => /** @type {`0x${string}`} */(it.signedEvmTransaction)),
                btcTransaction: btcTxData.tx.hex,
            })
            console.log('[OutgoingRequests] Refund broadcast hashes:', refundHashes)
            waitForTransaction({ txId: btcTxData.tx.id })
            setStatus('refunding')
        } catch (e) {
            console.error('[OutgoingRequests] Broadcast error:', e)
            setError(e.message || 'Failed to refund')
            setIsLoading(false)
            setStatus('error')
        }
    }

    const npub = request.providerPubkey ? nip19.npubEncode(request.providerPubkey) : '—'

    return (
        <div className="bg-black/20 border border-white/5 rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-white">Outgoing Request</p>
                    <p className="text-xs text-white/30 font-mono mt-0.5" title="Provider">To: {npub.slice(0, 24)}…</p>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase border ${lockData?.claimed ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : lockData?.refunded ? 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                        : isLockActive ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                    {lockData?.claimed ? 'Claimed by Provider' : lockData?.refunded ? 'Refunded' : isLockActive ? 'Active' : 'Unknown'}
                </span>
            </div>

            <div className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-2 text-xs">
                {request.secret && (
                    <div>
                        <span className="text-white/30 uppercase text-[10px] block mb-0.5">Your Secret</span>
                        <code className="text-accent break-all">{request.secret}</code>
                    </div>
                )}
                <div>
                    <span className="text-white/30 uppercase text-[10px] block mb-0.5">Hashlock</span>
                    <code className="text-primary break-all">{request.hashlock}</code>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-black/30 rounded-xl p-3">
                    <span className="text-white/30 uppercase text-[10px] block mb-0.5">Amount Locked</span>
                    <span className="text-white font-bold">{request.amount} EVM</span>
                </div>
                <div className="bg-black/30 rounded-xl p-3">
                    <span className="text-white/30 uppercase text-[10px] block mb-0.5">Lock Expires</span>
                    <span className="text-white font-bold">{lockExpiry ? lockExpiry.toLocaleString() : '—'}</span>
                </div>
            </div>

            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{error}</div>
            )}

            {canRefund && !['refunding', 'done'].includes(status) && (
                <ChainGuard>
                    <div className="p-4 glass bg-primary/5 space-y-3 border-primary/20 rounded-xl">
                        <p className="text-xs text-center text-white/50 mb-2">Reclaim Expired Funds:</p>
                        <button onClick={handlePrepareRefund} disabled={status !== 'pending' || txIntentions.length > 0} className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-30">
                            1. Prepare Refund Intention {status !== 'pending' && '✓'}
                        </button>

                        <button onClick={handleFinalizeBTC} disabled={status !== 'final' || isFinalizePending} className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-30">
                            {isFinalizePending ? '⏳ Waiting for wallet…' : `2. Calculate Gas & Finalize BTC ${status !== 'pending' && status !== 'final' ? '✓' : ''}`}
                        </button>

                        <button onClick={handleSignIntentions} disabled={status !== 'sign' || isLoading} className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-30">
                            {isLoading && status === 'sign' ? 'Signing...' : `3. Sign Refund Intentions ${status === 'broadcast' ? '✓' : ''}`}
                        </button>

                        <button onClick={handleBroadcast} disabled={status !== 'broadcast' || isLoading} className="w-full py-3 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 font-extrabold text-sm hover:brightness-110 disabled:opacity-30 shadow-[0_0_20px_oklch(0.8_0.15_150_/_0.3)]">
                            {isLoading && status === 'broadcast' ? 'Broadcasting & Waiting...' : '4. Broadcast Refund'}
                        </button>
                    </div>
                </ChainGuard>
            )}

            {(status === 'refunding') && (
                <div className="flex items-center justify-center gap-2 py-3 text-white/50 text-sm">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Executing refund on-chain...
                </div>
            )}

            {/* View Shared Data Button */}
            {lockData?.claimed && !decryptedData && (
                <button
                    onClick={handleFetchSharedData}
                    disabled={isFetchingData}
                    className="w-full py-2 rounded-xl bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-bold hover:bg-green-500/30 transition-colors mt-4">
                    {isFetchingData ? 'Fetching Data from Relays...' : '🔓 Fetch Shared Data'}
                </button>
            )}

            {/* Display Decrypted Data */}
            {decryptedData && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 space-y-3 mt-4">
                    <p className="text-sm font-bold text-green-400">✅ Data Received & Decrypted!</p>
                    {decryptedData.healthRecords?.length > 0 ? (
                        <div className="space-y-2">
                            {decryptedData.healthRecords.map((rec, i) => (
                                <div key={i} className="bg-black/40 border border-white/5 rounded-lg p-3">
                                    <p className="text-white/80 text-sm font-medium">{rec.label || 'Health Record'}</p>
                                    <p className="text-xs text-white/40 font-mono mt-1 break-all">CID: {rec.cid}</p>

                                    {rec.error ? (
                                        <p className="text-xs text-red-400 mt-2">Error: {rec.error}</p>
                                    ) : rec.fullData ? (
                                        <div className="mt-3 bg-black/50 p-3 rounded border border-white/5">
                                            <p className="text-xs text-white/50 uppercase tracking-widest mb-2 font-bold">Decrypted Content:</p>
                                            <pre className="text-xs text-white/70 whitespace-pre-wrap font-mono">
                                                {JSON.stringify(rec.fullData, null, 2)}
                                            </pre>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-yellow-400 mt-2">Loading payload...</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-white/40">Provider returned an empty document list.</p>
                    )}
                </div>
            )}
        </div>
    )
}

export default function OutgoingRequests() {
    const { pubkey, privKey, encryptedMessages, subscribeToDMs, decryptDM } = useNostr()
    const [requests, setRequests] = useState([])
    const [isLoading, setIsLoading] = useState(true)

    const loadRequests = useCallback(async () => {
        if (!pubkey) return
        setIsLoading(true)
        try {
            await subscribeToDMs('healthchain-v1-datashare', null)
        } finally {
            setIsLoading(false)
        }
    }, [pubkey, subscribeToDMs])

    useEffect(() => { loadRequests() }, [loadRequests])

    // Parse decrypted DMs into request objects
    useEffect(() => {
        const parseMessages = async () => {
            const parsed = []
            const responsesMap = {} // lockId -> data_access_response payload

            // 1. First pass to find all data_access_responses
            for (const msg of encryptedMessages) {
                // Responses come from the provider (NOT from us)
                if (msg.pubkey !== pubkey) {
                    try {
                        const decrypted = await decryptDM(msg)
                        if (!decrypted) {
                            console.log('[OutgoingRequests] Could not decrypt msg from', msg.pubkey);
                            continue;
                        }
                        const data = JSON.parse(decrypted)
                        console.log('[OutgoingRequests] Parsed incoming DM:', data.type, 'lockId:', data.lockId);
                        if (data.type === 'data_access_response' && data.lockId) {
                            responsesMap[data.lockId] = { ...data, senderMsgId: msg.id }
                            console.log('[OutgoingRequests] Stored response mapped for lockId:', data.lockId);
                        }
                    } catch (e) { console.error('[OutgoingRequests] error parsing incoming DM', e) }
                }
            }

            // 2. Second pass to find our original requests (self-DMs)
            const sentByMe = encryptedMessages.filter(msg => msg.pubkey === pubkey);
            for (const msg of sentByMe) {
                try {
                    const decrypted = await decryptDM(msg)
                    if (!decrypted) continue
                    const data = JSON.parse(decrypted)
                    if (data.type === 'outgoing_access_request') {
                        const response = responsesMap[data.lockId] || null;
                        console.log('[OutgoingRequests] Found our request lockId:', data.lockId, 'HasResponse:', !!response);
                        parsed.push({
                            ...data,
                            msgId: msg.id,
                            created_at: msg.created_at,
                            response
                        })
                    }
                } catch (e) { /* skip malformed */ }
            }
            // Sort by newest first
            parsed.sort((a, b) => b.created_at - a.created_at)
            setRequests(parsed)
        }
        if (encryptedMessages?.length) parseMessages()
    }, [encryptedMessages, decryptDM, pubkey])

    if (!pubkey) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <span className="text-4xl">🔐</span>
                <p className="text-white/40 text-sm">Connect wallet to see requested data</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-xs text-white/30 uppercase tracking-widest">
                    {isLoading ? 'Loading...' : `${requests.length} requested item${requests.length !== 1 ? 's' : ''}`}
                </span>
                <button onClick={loadRequests} className="text-xs text-white/30 hover:text-white transition-colors px-3 py-1 rounded-lg hover:bg-white/5">
                    ↻ Refresh
                </button>
            </div>

            {requests.length === 0 && !isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-white/5 rounded-2xl text-center gap-3">
                    <span className="text-4xl">📭</span>
                    <p className="text-white/30 text-sm">You haven't requested any data yet.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {requests.map(req => (
                        <OutgoingRequestCard
                            key={req.msgId}
                            request={req}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
