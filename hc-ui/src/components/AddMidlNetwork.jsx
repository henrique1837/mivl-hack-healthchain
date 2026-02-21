import { useAddNetwork } from "@midl/react";

function AddMidlNetwork() {
    const { addNetwork } = useAddNetwork();

    const onAddNetwork = async () => {
        try {
            await addNetwork({
                connectorId: "xverse",
                networkConfig: {
                    name: "MIDL Regtest",
                    network: "regtest",
                    rpcUrl: "https://rpc.staging.midl.xyz",
                    indexerUrl: "https://mempool.staging.midl.xyz",
                    explorerUrl: "https://blockscout.staging.midl.xyz",
                },
            });
            alert("Network added! Please check your Xverse wallet to ensure MIDL Regtest is selected.");
        } catch (e) {
            console.error(e);
            alert("Failed to add network: " + e.message);
        }
    };

    return (
        <button className="btn-primary flex items-center gap-2"
            type="button" onClick={onAddNetwork}>
            Add MIDL Regtest to Xverse
        </button>
    );
}

export default AddMidlNetwork;