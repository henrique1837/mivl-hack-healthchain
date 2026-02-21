// DataShareHTLC contract ABI + address
// Solidity equivalent (for reference):
// contract DataShareHTLC {
//   struct Lock {
//     address requester;   address provider;
//     uint256 amount;      bytes32 hashlock;
//     uint256 timelock;    bool claimed;      bool refunded;
//   }
//   mapping(bytes32 => Lock) public locks;
//   function lock(address provider, bytes32 hashlock, uint256 timelockDuration)
//     external payable returns (bytes32 lockId);
//   function claim(bytes32 lockId, bytes32 preimage) external;
//   function refund(bytes32 lockId) external;
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

// AES-GCM encrypt with a bytes32 hex secret as key
export async function encryptWithSecret(data, secretHex) {
    const raw = secretHex.replace('0x', '')
    const keyBytes = Uint8Array.from(raw.match(/.{1,2}/g).map(b => parseInt(b, 16)))
    const aesKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data))
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded)
    const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(cipherBuf), iv.byteLength)
    return btoa(String.fromCharCode(...combined))
}

// AES-GCM decrypt with a bytes32 hex secret as key
export async function decryptWithSecret(base64, secretHex) {
    const raw = secretHex.replace('0x', '')
    const keyBytes = Uint8Array.from(raw.match(/.{1,2}/g).map(b => parseInt(b, 16)))
    const aesKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
    )
    const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
    return new TextDecoder().decode(plainBuf)
}
