// DataShareHTLC contract ABI + address
// Solidity equivalent (for reference):
//
// contract DataShareHTLC {
//   struct Lock {
//     address requester;   address provider;
//     uint256 amount;      bytes32 hashlock;  // SHA256(secret)
//     uint256 timelock;    bool claimed;      bool refunded;
//   }
//   mapping(bytes32 => Lock) public locks;
//   function lock(address provider, bytes32 hashlock, uint256 timelockDuration)
//     external payable returns (bytes32 lockId); // lockId = keccak256(msg.sender, provider, hashlock, nonce)
//   function claim(bytes32 lockId, bytes32 preimage) external; // SHA256(preimage)==hashlock → pay provider
//   function refund(bytes32 lockId) external;                  // expired → refund requester
// }

export const HTLC_CONTRACT = {
    // TODO: replace with deployed address on MIDL regtest
    address: "0x2cF31938497C52d196182b29fF7D64e5E3930E43",
    abi: [
        // lock(provider, hashlock, timelockDuration) → lockId
        {
            "inputs": [
                { "internalType": "address", "name": "provider", "type": "address" },
                { "internalType": "bytes32", "name": "hashlock", "type": "bytes32" },
                { "internalType": "uint256", "name": "timelockDuration", "type": "uint256" }
            ],
            "name": "lock",
            "outputs": [{ "internalType": "bytes32", "name": "lockId", "type": "bytes32" }],
            "stateMutability": "payable",
            "type": "function"
        },
        // claim(lockId, preimage) → releases funds to provider
        {
            "inputs": [
                { "internalType": "bytes32", "name": "lockId", "type": "bytes32" },
                { "internalType": "bytes32", "name": "preimage", "type": "bytes32" }
            ],
            "name": "claim",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        // refund(lockId) → refunds requester after expiry
        {
            "inputs": [{ "internalType": "bytes32", "name": "lockId", "type": "bytes32" }],
            "name": "refund",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        // getLock(lockId) → Lock struct
        {
            "inputs": [{ "internalType": "bytes32", "name": "lockId", "type": "bytes32" }],
            "name": "getLock",
            "outputs": [
                {
                    "components": [
                        { "internalType": "address", "name": "requester", "type": "address" },
                        { "internalType": "address", "name": "provider", "type": "address" },
                        { "internalType": "uint256", "name": "amount", "type": "uint256" },
                        { "internalType": "bytes32", "name": "hashlock", "type": "bytes32" },
                        { "internalType": "uint256", "name": "timelock", "type": "uint256" },
                        { "internalType": "bool", "name": "claimed", "type": "bool" },
                        { "internalType": "bool", "name": "refunded", "type": "bool" }
                    ],
                    "internalType": "struct DataShareHTLC.Lock",
                    "name": "",
                    "type": "tuple"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        },
        // Events
        {
            "anonymous": false,
            "inputs": [
                { "indexed": true, "internalType": "bytes32", "name": "lockId", "type": "bytes32" },
                { "indexed": true, "internalType": "address", "name": "requester", "type": "address" },
                { "indexed": true, "internalType": "address", "name": "provider", "type": "address" },
                { "indexed": false, "internalType": "bytes32", "name": "hashlock", "type": "bytes32" },
                { "indexed": false, "internalType": "uint256", "name": "timelock", "type": "uint256" },
                { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
            ],
            "name": "Locked",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                { "indexed": true, "internalType": "bytes32", "name": "lockId", "type": "bytes32" },
                { "indexed": false, "internalType": "bytes32", "name": "preimage", "type": "bytes32" }
            ],
            "name": "Claimed",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [{ "indexed": true, "internalType": "bytes32", "name": "lockId", "type": "bytes32" }],
            "name": "Refunded",
            "type": "event"
        }
    ]
};


