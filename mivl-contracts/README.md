# HealthDataSwap Contracts ⚖️

The smart contract layer for HealthDataSwap, enabling trustless atomic swaps of data for value on the **MIDL Network**.

## 📄 Contract: `DataShareHTLC.sol`

The core of the platform is a Hashed Time-Lock Contract (HTLC) that ensures:
1.  **Atomic Swap**: Requesters only pay if the Provider reveals the secret preimage (which also serves as the data decryption key).
2.  **Trustless Escrow**: Funds are held by the contract and can either be claimed by the provider (with the secret) or refunded to the requester (after a timeout).

    Deployment: https://blockscout.staging.midl.xyz/address/0x2cF31938497C52d196182b29fF7D64e5E3930E43

### Core Functions

-   `lock(address provider, bytes32 hashlock, uint256 timelockDuration)`: Requesters lock EVM funds for a specific provider.
-   `claim(bytes32 lockId, bytes32 preimage)`: Providers reveal the secret to withdraw funds.
-   `refund(bytes32 lockId)`: Requesters reclaim funds if the lock expires without a claim.

## � Detailed Smart Contract Flows

This contract provides the crucial trust-layer between two untrusting parties sharing off-chain data.

### Requester Flow
1. **Initiate Payment:** The requester generates a random 32-byte secret (`preimage`) locally. They hash it (`sha256(preimage)`) and lock a set amount of funds calling `lock(provider, hashlock, timelockDuration)`. 
   - `provider`: The wallet address of the user who owns the data.
   - `hashlock`: The `sha256` hash of the requester's secret.
   - `timelockDuration`: Time (in seconds) the provider has to fulfill the request.
2. **Setup Swap:** The requester sends the raw `preimage` secret to the provider via a secure off-chain channel (e.g., encrypted Nostr DM).
3. **Refund:** If the provider fails to deliver the data and claim the funds, the requester can call `refund(lockId)` after the `timelock` expires, reclaiming their funds securely.

### Provider Flow
1. **Accept Request:** The provider receives the off-chain access request containing the requester's `preimage` secret.
2. **Claim Payment**: The provider validates the requester's lock details (`getLock(lockId)`), ensuring the hash matches the provided secret. They then call `claim(lockId, preimage)`, withdrawing the funds!
3. **Delivery Mechanism**: Simultaneously, the provider uses that exact same `preimage` as the symmetric AES encryption key for the health data pointers they send back to the requester via the off-chain channel. Since the requester generated the secret, they can seamlessly decrypt it! 

## 🛠️ Development & Testing

### Prerequisites
- Node.js >= 20.
- pnpm package manager.

### Installation
```bash
pnpm install
```

### Running Tests
The test suite validates the full HTLC lifecycle (Locking, Successful Claim, Wrong Preimage, Expiration, and Refund).
```bash
pnpm hardhat test
```

### Contract Verification
To verify the contract on the Blockscout explorer for the REGTEST deployment:
```bash
pnpm hardhat verify --network regtest 0x2cF31938497C52d196182b29fF7D64e5E3930E43
```

## 🌐 Network Configuration (Regtest)
- **Chain ID**: `15001`
- **RPC URL**: `https://rpc.staging.midl.xyz`
- **Explorer URL**: `https://blockscout.staging.midl.xyz`

## 📜 License
MIT
