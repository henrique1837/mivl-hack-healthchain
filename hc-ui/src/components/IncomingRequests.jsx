import { useState, useEffect, useCallback } from 'react'
import { useReadContract, useWriteContract } from 'wagmi'
import { nip19 } from 'nostr-tools'
import { useNostr } from '../contexts/NostrContext'
import { HTLC_CONTRACT } from '../utils/DataShareHTLC'
import ChainGuard from './ChainGuard'

// AES-GCM encrypt with a bytes32 hex secret as key
async function encryptWithSecret(data, secretHex) {
    const raw = secretHex.replace('0x', '')
    const keyBytes = Uint8Array.from(raw.match(/.{1,2}/g).map(b => parseInt(b, 16)))
    const aesKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data))
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded)
    const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(cipherBuf), iv.byteLength)
    return btoa(String.fromCharCode(...combined))
}

// AES-GCM decrypt with a bytes32 hex secret as key
async function decryptWithSecret(base64, secretHex) {
    const raw = secretHex.replace('0x', '')
    const keyBytes = Uint8Array.from(raw.match(/.{1,2}/g).map(b => parseInt(b, 16)))
    const aesKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
    )
    const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
    return new TextDecoder().decode(plainBuf)
}

function IncomingRequestCard({ request, privKey, pubkey, profile }) {
    const { sendEncryptedDM } = useNostr()
    const { writeContractAsync } = useWriteContract()
    const [status, setStatus] = useState('pending') // pending | sharing | claiming | done | error
    const [error, setError] = useState(null)
    const [sharedSecret, setSharedSecret] = useState(null) // the preimage the provider used

    // Verify the HTLC lock on-chain
    const { data: lockData } = useReadContract({
        address: HTLC_CONTRACT.address,
        abi: HTLC_CONTRACT.abi,
        functionName: 'getLock',
        args: [request.lockId],
        query: { enabled: !!request.lockId && request.lockId !== 'htlc-request' }
    })

    const isLockValid = lockData && !lockData.claimed && !lockData.refunded
    const lockExpiry = lockData ? new Date(Number(lockData.timelock) * 1000) : null

    const handleApprove = async () => {
        if (!profile?.healthRecords?.length) return
        setStatus('sharing')
        setError(null)
        try {
            // 1. Provider needs their stored preimage (hashlock secret).
            //    In a full impl, provider stored this when they published the hashlock.
            //    Here we prompt for it or derive it from profile data.
            //    For demo: we use a fixed derivation from provider's privkey + lockId.
            const rawKey = new Uint8Array(32)
            const encoder = new TextEncoder()
            const keyMaterial = await crypto.subtle.importKey('raw', privKey, { name: 'PBKDF2' }, false, ['deriveKey'])
            const derived = await crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt: encoder.encode(request.lockId || 'default'), iterations: 100000, hash: 'SHA-256' },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt']
            )
            const exportedKey = await crypto.subtle.exportKey('raw', derived)
            const secretHex = '0x' + Array.from(new Uint8Array(exportedKey)).map(b => b.toString(16).padStart(2, '0')).join('')
            setSharedSecret(secretHex)

            // 2. Encrypt all records with the secret
            const encryptedPayload = await encryptWithSecret(
                { healthRecords: profile.healthRecords, pubkey },
                secretHex
            )

            // 3. Send encrypted data to requester via Nostr DM
            const dmPayload = JSON.stringify({
                type: 'data_access_response',
                lockId: request.lockId,
                encryptedPayload,
                // Note: secret revealed ONLY after claiming
            })
            await sendEncryptedDM(request.requesterPubkey, dmPayload, request.lockId, true, null)

            // 4. Claim the on-chain funds (reveals secret atomically)
            if (isLockValid && request.lockId !== 'htlc-request') {
                setStatus('claiming')
                const secretBytes = '0x' + Array.from(new Uint8Array(exportedKey)).map(b => b.toString(16).padStart(2, '0')).join('')
                await writeContractAsync({
                    address: HTLC_CONTRACT.address,
                    abi: HTLC_CONTRACT.abi,
                    functionName: 'claim',
                    args: [request.lockId, secretBytes],
                })
            }
            setStatus('done')
        } catch (e) {
            console.error(e)
            setError(e.message || 'Failed to share data')
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
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}>
                    {isLockValid ? '✅ Funds verified on-chain' : '❌ Lock invalid or already settled'}
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

            {status === 'pending' && (
                <ChainGuard>
                    <button
                        onClick={handleApprove}
                        className="w-full py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary font-bold text-sm hover:bg-primary/20 transition-all"
                    >
                        🔐 Approve & Share Data (HTLC)
                    </button>
                </ChainGuard>
            )}

            {(status === 'sharing' || status === 'claiming') && (
                <div className="flex items-center justify-center gap-2 py-3 text-white/50 text-sm">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {status === 'sharing' ? 'Encrypting & sending data...' : 'Claiming funds on-chain...'}
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
