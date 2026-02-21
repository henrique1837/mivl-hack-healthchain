import { useState, useEffect, useCallback } from 'react'
import { useNostr } from '../contexts/NostrContext'
import { nip19 } from 'nostr-tools'
import AccessRequestFlow from './AccessRequestFlow'

const RECORD_TYPE_ICONS = {
    blood_pressure: '❤️', glucose: '🩸', weight: '⚖️', medication: '💊', notes: '📝'
}

function getIcon(label = '') {
    const lower = label.toLowerCase()
    if (lower.includes('blood pressure')) return '❤️'
    if (lower.includes('glucose')) return '🩸'
    if (lower.includes('weight')) return '⚖️'
    if (lower.includes('medication')) return '💊'
    return '📝'
}

export default function UsersDirectory({ currentAccounts }) {
    const { fetchAllProfiles, pubkey: myPubkey } = useNostr()
    const [profiles, setProfiles] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    const [expanded, setExpanded] = useState(null)
    const [requestTarget, setRequestTarget] = useState(null) // profile to request access from

    const load = useCallback(async () => {
        setIsLoading(true)
        try {
            const all = await fetchAllProfiles()
            // Exclude self
            setProfiles(all.filter(p => p.pubkey !== myPubkey))
        } catch (e) {
            console.error(e)
        } finally {
            setIsLoading(false)
        }
    }, [fetchAllProfiles, myPubkey])

    useEffect(() => { load() }, [load])

    if (requestTarget) {
        return (
            <AccessRequestFlow
                provider={requestTarget}
                requesterAccounts={currentAccounts}
                onBack={() => setRequestTarget(null)}
            />
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-xs text-white/30 uppercase tracking-widest">
                    {isLoading ? 'Loading profiles...' : `${profiles.length} HealthDataSwap users`}
                </span>
                <button onClick={load} className="text-xs text-white/30 hover:text-white transition-colors px-3 py-1 rounded-lg hover:bg-white/5">
                    ↻ Refresh
                </button>
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />
                    ))}
                </div>
            ) : profiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-white/5 rounded-2xl text-center gap-3">
                    <span className="text-4xl">👥</span>
                    <p className="text-white/30 text-sm">No other HealthDataSwap users found yet.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {profiles.map(profile => {
                        const npub = profile.pubkey ? nip19.npubEncode(profile.pubkey) : '—'
                        const records = profile.healthRecords ?? []
                        const isExpanded = expanded === profile.pubkey
                        const hasHashlock = !!profile.data_hashlock

                        return (
                            <div key={profile.pubkey} className="bg-black/20 border border-white/5 rounded-2xl overflow-hidden transition-all hover:border-white/10">
                                {/* Header row */}
                                <div className="flex items-center gap-4 p-4">
                                    {/* Avatar */}
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center text-xl flex-shrink-0 font-bold text-white">
                                        {profile.name?.[0]?.toUpperCase() || '👤'}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-white text-sm truncate">
                                            {profile.name || 'Anonymous'}
                                        </p>
                                        <p className="text-xs text-white/30 font-mono truncate">{npub.slice(0, 20)}…</p>
                                        {profile.walletAddress && (
                                            <p className="text-[10px] text-accent/60 font-mono truncate mt-0.5">
                                                {profile.walletAddress.slice(0, 10)}…
                                            </p>
                                        )}
                                    </div>

                                    {/* Record count badge */}
                                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                        <span className="text-xs font-bold px-2 py-1 bg-primary/10 text-primary rounded-lg border border-primary/20">
                                            {records.length} record{records.length !== 1 ? 's' : ''}
                                        </span>
                                        {records.length > 0 && (
                                            <button
                                                onClick={() => setExpanded(isExpanded ? null : profile.pubkey)}
                                                className="text-[10px] text-white/30 hover:text-white transition-colors"
                                            >
                                                {isExpanded ? '▲ hide' : '▼ show'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Expanded records list */}
                                {isExpanded && records.length > 0 && (
                                    <div className="px-4 pb-3 space-y-1 border-t border-white/5">
                                        {records.map((rec, i) => (
                                            <div key={i} className="flex items-center gap-3 py-2">
                                                <span className="text-lg">{getIcon(rec.label)}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs text-white/70 truncate">{rec.label}</p>
                                                    <p className="text-[10px] text-white/20 font-mono truncate">{rec.cid}</p>
                                                </div>
                                                <span className="text-[10px] text-white/20">
                                                    {rec.timestamp ? new Date(rec.timestamp * 1000).toLocaleDateString() : ''}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Request access footer */}
                                {records.length > 0 && (
                                    <div className="px-4 pb-4">
                                        <button
                                            onClick={() => setRequestTarget(profile)}
                                            className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${hasHashlock
                                                ? 'bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20'
                                                : 'bg-white/5 border border-white/10 text-white/30 hover:bg-white/10 hover:text-white'
                                                }`}
                                        >
                                            {hasHashlock ? '🔐 Request Access (HTLC)' : '🔓 Request Access'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
