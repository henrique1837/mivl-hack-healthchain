import { useState, useEffect } from 'react'
import {
  useAccounts,
  useConnect,
  useDisconnect,
  useWaitForTransaction
} from "@midl/react"
import {
  useAddTxIntention,
  useFinalizeBTCTransaction,
  useSignIntention
} from "@midl/executor-react"
import { encodeFunctionData } from "viem"
import { usePublicClient, useReadContract } from "wagmi"
import { HEALTH_CHAIN_CONTRACT } from './utils/HealthChain'

function App() {
  const { isConnected, accounts } = useAccounts({})
  const { connect, connectors } = useConnect({})
  const { disconnect } = useDisconnect({})
  const publicClient = usePublicClient()

  const [step, setStep] = useState(0) // 0: Idle, 1: Intention Added, 2: BTC Finalized, 3: Signed
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(null)

  // MIDL Hooks for Write Operations
  const { addTxIntention, txIntentions } = useAddTxIntention()
  const { finalizeBTCTransaction, data: btcTxData } = useFinalizeBTCTransaction()
  const { signIntentionAsync } = useSignIntention()
  const { waitForTransaction } = useWaitForTransaction({
    mutation: {
      onSuccess: () => {
        setLoading(false)
        setSuccess("Transaction Successful!")
        setStep(0)
      }
    }
  })

  // Contract Read
  const { data: registeredKey, refetch: refetchKey } = useReadContract({
    abi: HEALTH_CHAIN_CONTRACT.abi,
    functionName: "getEncryptionPubKey",
    address: HEALTH_CHAIN_CONTRACT.address,
    args: [accounts?.[0]?.evmAddress],
    query: { enabled: !!accounts?.[0]?.evmAddress }
  })

  const onAddIntention = () => {
    if (!accounts?.[0]?.publicKey) return
    addTxIntention({
      reset: true,
      intention: {
        evmTransaction: {
          to: HEALTH_CHAIN_CONTRACT.address,
          data: encodeFunctionData({
            abi: HEALTH_CHAIN_CONTRACT.abi,
            functionName: "registerEncryptionPubKey",
            args: [accounts?.[0].publicKey],
          }),
        },
      },
    })
    setStep(1)
  }

  const onFinalizeBTC = () => {
    finalizeBTCTransaction()
    setStep(2)
  }

  const onSign = async () => {
    if (!btcTxData) return
    setLoading(true)
    try {
      for (const intention of txIntentions) {
        await signIntentionAsync({
          intention,
          txId: btcTxData.tx.id,
        })
      }
      setStep(3)
    } finally {
      setLoading(false)
    }
  }

  const onBroadcast = async () => {
    if (!btcTxData) return
    setLoading(true)
    try {
      await publicClient?.sendBTCTransactions({
        serializedTransactions: txIntentions.map(it => it.signedEvmTransaction),
        btcTransaction: btcTxData.tx.hex,
      })
      waitForTransaction({ txId: btcTxData.tx.id })
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <header className="flex justify-between items-center mb-16">
        <div>
          <h1 className="text-4xl font-extrabold gradient-text tracking-tight">HealthChain</h1>
          <p className="text-white/60 mt-1">Decentralized Health Records on Bitcoin</p>
        </div>

        {!isConnected ? (
          <button
            onClick={() => connect({ connector: connectors[0] })}
            className="btn-primary flex items-center gap-2"
          >
            <span>Connect Xverse</span>
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          </button>
        ) : (
          <div className="flex items-center gap-4">
            <div className="glass px-4 py-2 flex flex-col items-end">
              <span className="text-[10px] text-white/40 uppercase tracking-widest">Connected Wallet</span>
              <span className="text-sm font-mono text-primary">{accounts[0]?.evmAddress?.slice(0, 6)}...{accounts[0]?.evmAddress?.slice(-4)}</span>
            </div>
            <button onClick={() => disconnect()} className="text-white/40 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Left Column: Stats & ID */}
        <div className="lg:col-span-4 space-y-8">
          <section className="glass p-8 card-hover relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08s5.97 1.09 6 3.08c-1.29 1.94-3.5 3.22-6 3.22z" /></svg>
            </div>

            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="text-primary text-2xl">01</span> HealthID
            </h2>

            {isConnected ? (
              <div className="space-y-6">
                <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                  <span className="text-[10px] text-white/30 uppercase block mb-1">Public Key</span>
                  <code className="text-xs break-all text-accent">{accounts[0]?.publicKey?.slice(0, 48)}...</code>
                </div>

                {registeredKey ? (
                  <div className="flex flex-col items-center gap-2 p-6 bg-accent/5 rounded-2xl border border-accent/20">
                    <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-accent">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-sm font-bold text-accent uppercase tracking-widest">Identity Verified</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button onClick={onAddIntention} disabled={step !== 0} className="w-full btn-primary disabled:opacity-30">
                      1. Register Identity
                    </button>

                    {step >= 1 && (
                      <div className="mt-4 p-4 glass bg-primary/5 space-y-4 border-primary/20 animate-in fade-in slide-in-from-top-4">
                        <p className="text-xs text-center text-white/60">Complete the flow to broadcast</p>

                        <button onClick={onFinalizeBTC} disabled={step !== 1} className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-30">
                          2. Finalize BTC Fee Transfer
                        </button>

                        <button onClick={onSign} disabled={step !== 2 || loading} className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-30">
                          3. Sign Transaction
                        </button>

                        <button onClick={onBroadcast} disabled={step !== 3 || loading} className="w-full py-3 rounded-xl bg-accent text-black font-extrabold text-sm hover:brightness-110 disabled:opacity-30 shadow-[0_0_20px_oklch(0.8_0.15_150_/_0.3)]">
                          {loading ? 'Broadcasting...' : '4. Broadcast to MIDL'}
                        </button>
                      </div>
                    )}
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

        {/* Right Column: Placeholder for Records */}
        <div className="lg:col-span-8 space-y-8">
          <section className="glass p-8 min-h-[400px] flex flex-col justify-center items-center text-center">
            <div className="w-20 h-20 rounded-3xl bg-surface border border-white/5 flex items-center justify-center mb-6 text-white/10">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Health Records Dashboard</h2>
            <p className="text-white/40 max-w-sm">Securely storage and share your medical data on-chain using the MIDL Protocol.</p>
            {success && <div className="mt-8 p-3 bg-green-500/20 text-green-400 rounded-xl border border-green-500/20 text-sm font-bold">{success}</div>}
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
