import { useAddNetwork } from "@midl/react";

function AddMidlNetwork() {
    const { addNetwork } = useAddNetwork();

    const onAddNetwork = () => {
        addNetwork({
            connectorId: "xverse",
            networkConfig: {
                name: "MIDL Regtest",
                network: "regtest",
                rpcUrl: "https://rpc.staging.midl.xyz",
                indexerUrl: "https://mempool.staging.midl.xyz",
            },
        });
        alert("done")
    };

    return (
        <button className="btn-primary flex items-center gap-2"
            type="button" onClick={onAddNetwork}>
            Add MIDL Regtest to Xverse
        </button>
    );
}

export default AddMidlNetwork;