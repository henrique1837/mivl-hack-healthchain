export const HEALTH_CHAIN_CONTRACT = {
    address: "0xBF80Cc12C86a4bB5fe841B68C383C68bBB39c291",
    abi: [
        {
            "inputs": [{ "internalType": "string", "name": "_encryptionPubKey", "type": "string" }],
            "name": "registerEncryptionPubKey",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "inputs": [{ "internalType": "address", "name": "_userAddress", "type": "address" }],
            "name": "getEncryptionPubKey",
            "outputs": [{ "internalType": "string", "name": "", "type": "string" }],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "inputs": [
                { "internalType": "string", "name": "_ipfsCid", "type": "string" },
                { "internalType": "string", "name": "_recordHash", "type": "string" }
            ],
            "name": "registerRecord",
            "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "inputs": [{ "internalType": "uint256", "name": "_recordId", "type": "uint256" }],
            "name": "getRecord",
            "outputs": [
                {
                    "components": [
                        { "internalType": "address", "name": "owner", "type": "address" },
                        { "internalType": "string", "name": "ipfsCid", "type": "string" },
                        { "internalType": "uint256", "name": "timestamp", "type": "uint256" },
                        { "internalType": "string", "name": "recordHash", "type": "string" },
                        { "internalType": "string", "name": "ownerEncryptionPubKey", "type": "string" }
                    ],
                    "internalType": "struct HealthChain.HealthRecord",
                    "name": "",
                    "type": "tuple"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        }
    ]
};
