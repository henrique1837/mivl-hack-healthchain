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
    address: "0x0000000000000000000000000000000000000000",
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

// The Solidity source to deploy on MIDL regtest:
export const HTLC_SOLIDITY_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DataShareHTLC {
    struct Lock {
        address requester;
        address provider;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool claimed;
        bool refunded;
    }

    mapping(bytes32 => Lock) public locks;
    uint256 private nonce;

    event Locked(bytes32 indexed lockId, address indexed requester, address indexed provider, bytes32 hashlock, uint256 timelock, uint256 amount);
    event Claimed(bytes32 indexed lockId, bytes32 preimage);
    event Refunded(bytes32 indexed lockId);

    function lock(address provider, bytes32 hashlock, uint256 timelockDuration)
        external payable returns (bytes32 lockId)
    {
        require(msg.value > 0, "Must lock some value");
        require(provider != address(0), "Invalid provider");
        require(timelockDuration > 0, "Invalid timelock");

        lockId = keccak256(abi.encodePacked(msg.sender, provider, hashlock, nonce++));
        require(locks[lockId].requester == address(0), "Lock exists");

        locks[lockId] = Lock({
            requester: msg.sender,
            provider: provider,
            amount: msg.value,
            hashlock: hashlock,
            timelock: block.timestamp + timelockDuration,
            claimed: false,
            refunded: false
        });

        emit Locked(lockId, msg.sender, provider, hashlock, block.timestamp + timelockDuration, msg.value);
    }

    function claim(bytes32 lockId, bytes32 preimage) external {
        Lock storage l = locks[lockId];
        require(l.provider == msg.sender, "Only provider can claim");
        require(!l.claimed && !l.refunded, "Already settled");
        require(block.timestamp < l.timelock, "Lock expired");
        require(sha256(abi.encodePacked(preimage)) == l.hashlock, "Wrong preimage");

        l.claimed = true;
        payable(l.provider).transfer(l.amount);
        emit Claimed(lockId, preimage);
    }

    function refund(bytes32 lockId) external {
        Lock storage l = locks[lockId];
        require(l.requester == msg.sender, "Only requester can refund");
        require(!l.claimed && !l.refunded, "Already settled");
        require(block.timestamp >= l.timelock, "Not yet expired");

        l.refunded = true;
        payable(l.requester).transfer(l.amount);
        emit Refunded(lockId);
    }

    function getLock(bytes32 lockId) external view returns (Lock memory) {
        return locks[lockId];
    }
}
`;
