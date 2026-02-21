# HealthDataSwap Contracts ⚖️

The smart contract layer for HealthDataSwap, enabling trustless atomic swaps of data for value on the **MIDL Network**.

## 📄 Contract: `DataShareHTLC.sol`

The core of the platform is a Hashed Time-Lock Contract (HTLC) that ensures:
1.  **Atomic Swap**: Requesters only pay if the Provider reveals the secret preimage (which also serves as the data decryption key).
2.  **Trustless Escrow**: Funds are held by the contract and can either be claimed by the provider (with the secret) or refunded to the requester (after a timeout).

### Core Functions

-   `lock(address provider, bytes32 hashlock, uint256 timelockDuration)`: Requesters lock EVM funds for a specific provider.
-   `claim(bytes32 lockId, bytes32 preimage)`: Providers reveal the secret to withdraw funds.
-   `refund(bytes32 lockId)`: Requesters reclaim funds if the lock expires without a claim.

## 🛠️ Development & Testing

### Prerequisites
- [MIDL Network](https://docs.midl.xyz) access.
- Node.js >= 20.

### Installation
```bash
npm install
```

### Running Tests
The test suite validates the full HTLC lifecycle (Locking, Successful Claim, Wrong Preimage, Expiration, and Refund).
```bash
npx hardhat test
```

### Deployment
To deploy to the MIDL Regtest network:
1.  Update `hardhat.config.ts` with the MIDL RPC URL and your private key.
2.  Run the deployment script:
    ```bash
    npx hardhat run scripts/deploy.ts --network midl
    ```

## 🌐 Network Configuration (Regtest)
- **Chain ID**: `15001`
- **RPC URL**: `https://rpc.regtest.midl.xyz` (Example)

## 📜 License
MIT
