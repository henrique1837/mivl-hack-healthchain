import { useChainId, useSwitchChain } from 'wagmi'

// MIDL Regtest chain ID
export const MIDL_CHAIN_ID = 15001

/**
 * Returns whether the current Wagmi chain matches MIDL regtest.
 * If not, provides a `switchToMidl` function to prompt the user to switch.
 */
export function useMidlChain() {
    const chainId = useChainId()
    const { switchChain, isPending } = useSwitchChain()

    const isCorrectChain = chainId === MIDL_CHAIN_ID

    const switchToMidl = () => {
        switchChain({ chainId: MIDL_CHAIN_ID })
    }

    return { isCorrectChain, switchToMidl, isSwitching: isPending, currentChainId: chainId }
}
