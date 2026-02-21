import { useMidlChain } from '../hooks/useMidlChain'

/**
 * Renders a warning banner + switch button when the user is not on MIDL chain.
 * Wraps children — if on wrong chain, children are replaced by the guard UI.
 */
export default function ChainGuard({ children }) {
    const { isCorrectChain, switchToMidl, isSwitching } = useMidlChain()

    if (isCorrectChain) return children

    return (
        <div className="p-6 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 space-y-4 flex flex-col items-center text-center">
            <div className="text-4xl">⛓️</div>
            <div>
                <p className="font-bold text-yellow-400 text-sm uppercase tracking-widest mb-1">Wrong Network</p>
                <p className="text-white/50 text-xs max-w-xs">
                    This feature requires the <span className="text-yellow-400 font-semibold">MIDL Regtest</span> EVM network.
                    Switch to continue.
                </p>
            </div>
            <button
                onClick={switchToMidl}
                disabled={isSwitching}
                className="px-6 py-2 rounded-xl bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 font-bold text-sm hover:bg-yellow-500/30 transition-all disabled:opacity-50"
            >
                {isSwitching ? 'Switching...' : '🔄 Switch to MIDL Regtest'}
            </button>
        </div>
    )
}
