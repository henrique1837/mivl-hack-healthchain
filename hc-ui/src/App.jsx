import React, { useState, useEffect } from 'react'
import {
  useAccounts,
  useDisconnect,
} from "@midl/react"
import { ConnectButton } from "@midl/satoshi-kit";
import { useEVMAddress } from "@midl/executor-react";

import { nip19 } from 'nostr-tools'

import AddMidlNetwork from './components/AddMidlNetwork'
import HealthDataUpload from './components/HealthDataUpload'
import UsersDirectory from './components/UsersDirectory'
import IncomingRequests from './components/IncomingRequests'
import OutgoingRequests from './components/OutgoingRequests'
import { useNostr } from './contexts/NostrContext'

const TABS = [
  { id: 'records', label: '📋 My Records' },
  { id: 'add', label: '➕ Add Record' },
  { id: 'users', label: '👥 Users' },
  { id: 'requests', label: '📥 Incoming Requests' },
  { id: 'requested', label: '📤 Requested Data' },
]

function App() {
  const { isConnected, accounts } = useAccounts()
  const { connectWithMidl, pubkey, profile, isLoading: nostrLoading } = useNostr()
  const { disconnect } = useDisconnect()
  const myEvmAddress = useEVMAddress()

  const [success, setSuccess] = useState(null)
  const [activeTab, setActiveTab] = useState('records')

  // derivingRef prevents double-triggering while the async derivation is in-flight
  const derivingRef = React.useRef(false)

  useEffect(() => {
    if (!isConnected) {
      // Wallet disconnected — reset the guard so next reconnect triggers fresh
      derivingRef.current = false
      return
    }
    const addr = accounts?.[0]?.address
    if (addr && !pubkey && !derivingRef.current) {
      derivingRef.current = true
      connectWithMidl().finally(() => { derivingRef.current = false })
    }
  }, [isConnected, accounts?.[0]?.address, pubkey, connectWithMidl])

  const healthRecords = profile?.healthRecords ?? []

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">

      {/* Header */}
      <header className="flex justify-between items-center mb-16">
        <div>
          <h1 className="text-4xl font-extrabold gradient-text tracking-tight">HealthChain</h1>
          <p className="text-white/60 mt-1">Decentralized Health Records on Bitcoin</p>
        </div>
        <div className="flex items-center gap-3">
          <AddMidlNetwork />
          {!isConnected ? (
            <ConnectButton />
          ) : (
            <div className="flex items-center gap-3">
              <div className="glass px-4 py-2 flex flex-col items-end gap-0.5">
                <span className="text-[10px] text-white/40 uppercase tracking-widest">Connected</span>
                <span className="text-xs font-mono text-primary" title="EVM Address">
                  EVM: {myEvmAddress ? `${myEvmAddress.slice(0, 6)}…${myEvmAddress.slice(-4)}` : '—'}
                </span>
                <span className="text-[10px] font-mono text-white/30" title={accounts[0]?.address}>
                  BTC: {accounts[0]?.address?.slice(0, 10)}…
                </span>
              </div>
              <button onClick={() => disconnect()} className="text-white/40 hover:text-white transition-colors" title="Disconnect">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Left: HealthID */}
        <div className="lg:col-span-4 space-y-8">
          <section className="glass p-8 card-hover relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08s5.97 1.09 6 3.08c-1.29 1.94-3.5 3.22-6 3.22z" />
              </svg>
            </div>

            <h2 className="text-xl font-bold mb-5 flex items-center gap-2">
              <span className="text-primary text-2xl">01</span> HealthID
            </h2>

            {isConnected ? (
              <div className="space-y-4">
                {/* Wallet Addresses */}
                <div className="bg-black/20 rounded-xl p-4 border border-white/5 space-y-3">
                  <div>
                    <span className="text-[10px] text-white/30 uppercase block mb-1">🔗 EVM Address (MIDL)</span>
                    <code className="text-xs break-all text-primary">{myEvmAddress || '—'}</code>
                  </div>
                  <div>
                    <span className="text-[10px] text-white/30 uppercase block mb-1">₿ Bitcoin Address</span>
                    <code className="text-xs break-all text-accent">{accounts[0]?.address || '—'}</code>
                  </div>
                </div>

                {/* Nostr Identity status */}
                {nostrLoading && !pubkey ? (
                  <div className="bg-primary/5 rounded-xl p-4 border border-primary/10 flex items-center gap-3">
                    <svg className="animate-spin h-4 w-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs text-primary/70">Generating Nostr identity…</span>
                  </div>
                ) : !pubkey ? (
                  <div className="bg-yellow-500/10 rounded-xl p-4 border border-yellow-500/20 space-y-2">
                    <p className="text-[10px] text-yellow-400 uppercase tracking-widest">Nostr Identity Missing</p>
                    <p className="text-xs text-white/40">Sign a message with Xverse to generate your decentralized identity.</p>
                    <button
                      onClick={() => connectWithMidl()}
                      className="w-full py-2 rounded-xl bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 font-bold text-xs hover:bg-yellow-500/30 transition-all"
                    >
                      🔑 Generate Nostr Keys
                    </button>
                  </div>
                ) : (
                  <div className="bg-primary/10 rounded-xl p-4 border border-primary/20">
                    <span className="text-[10px] text-primary uppercase block mb-1">Nostr NPUB</span>
                    <code className="text-xs break-all text-primary">{nip19.npubEncode(pubkey)}</code>
                  </div>
                )}

                {pubkey && (
                  <div className="bg-black/10 rounded-xl p-3 border border-white/5 text-center">
                    <span className="text-xl font-bold text-white">{healthRecords.length}</span>
                    <span className="text-[10px] text-white/30 block uppercase">Records</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed border-white/5 rounded-3xl">
                <p className="text-white/20 text-sm italic">Connect wallet to manage ID</p>
              </div>
            )}
          </section>
        </div>

        {/* Right: Tabbed Dashboard */}
        <div className="lg:col-span-8 space-y-6">
          {/* Tab bar */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === tab.id
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-white/40 hover:text-white bg-white/5 hover:bg-white/10'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <section className="glass p-8 min-h-[400px]">

            {/* My Records */}
            {activeTab === 'records' && (
              <div>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <span className="text-primary text-2xl">02</span> Health Records
                </h2>

                {!isConnected ? (
                  <div className="flex flex-col items-center justify-center min-h-[280px] text-center gap-4">
                    <div className="w-20 h-20 rounded-3xl bg-surface border border-white/5 flex items-center justify-center text-4xl">🏥</div>
                    <p className="text-white/40 max-w-sm text-sm">Connect your wallet to view your health records.</p>
                  </div>
                ) : healthRecords.length === 0 ? (
                  <div className="flex flex-col items-center justify-center min-h-[260px] border-2 border-dashed border-white/5 rounded-2xl text-center gap-3 p-8">
                    <span className="text-5xl">📂</span>
                    <p className="text-white/30 text-sm">No records yet.</p>
                    <button onClick={() => setActiveTab('add')} className="btn-primary mt-2 text-sm px-6 py-2">➕ Add First Record</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {healthRecords.map((rec, i) => (
                      <div key={i} className="flex items-center gap-4 p-4 bg-black/20 border border-white/5 rounded-xl hover:border-white/10 transition-all">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg flex-shrink-0">
                          {rec.label?.includes('Blood Pressure') ? '❤️' : rec.label?.includes('Glucose') ? '🩸' : rec.label?.includes('Weight') ? '⚖️' : rec.label?.includes('Medication') ? '💊' : '📝'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{rec.label}</p>
                          <p className="text-xs text-white/30 font-mono mt-0.5 truncate">{rec.cid}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-xs text-white/30 block">{rec.timestamp ? new Date(rec.timestamp * 1000).toLocaleDateString() : '—'}</span>
                          <span className="text-[10px] text-primary/60 uppercase font-bold">Encrypted</span>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setActiveTab('add')} className="w-full py-3 border border-dashed border-white/10 rounded-xl text-white/40 hover:text-white hover:border-white/20 transition-all text-sm">
                      ➕ Add Another Record
                    </button>
                  </div>
                )}
                {success && (
                  <div className="mt-4 p-3 bg-green-500/20 text-green-400 rounded-xl border border-green-500/20 text-sm font-bold animate-in fade-in">{success}</div>
                )}
              </div>
            )}

            {/* Add Record */}
            {activeTab === 'add' && (
              <div>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <span className="text-primary text-2xl">03</span> Add Health Record
                </h2>
                <HealthDataUpload
                  accounts={accounts}
                  onSuccess={({ type }) => {
                    setActiveTab('records')
                    setSuccess(`✅ ${type} record saved!`)
                    setTimeout(() => setSuccess(null), 5000)
                  }}
                />
              </div>
            )}

            {/* Users Directory */}
            {activeTab === 'users' && (
              <div>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <span className="text-primary text-2xl">04</span> HealthChain Users
                </h2>
                <UsersDirectory currentAccounts={accounts} />
              </div>
            )}

            {/* Incoming Requests */}
            {activeTab === 'requests' && (
              <div>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <span className="text-primary text-2xl">05</span> Incoming Requests
                </h2>
                <IncomingRequests mineProfile={profile} />
              </div>
            )}

            {/* Outgoing Requests */}
            {activeTab === 'requested' && (
              <div>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <span className="text-primary text-2xl">06</span> Requested Data
                </h2>
                <OutgoingRequests />
              </div>
            )}

          </section>
        </div>
      </main>
    </div>
  )
}

export default App
