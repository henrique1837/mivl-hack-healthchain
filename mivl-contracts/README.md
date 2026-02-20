# HealthChain

HealthChain is a decentralized platform for managing health identities and securely sharing encrypted medical records via atomic swaps on the MIDL network.

## Features

- **Decentralized HealthID**: Register and manage asymmetric encryption public keys linked to your EVM address.
- **Secure Health Records**: Register encrypted health record pointers (IPFS CIDs) with integrity hashes.
- **Atomic Data Swaps**: Buy and sell access to medical data using a secure, trustless hashlock-based escrow mechanism.

## Prerequisites

- **Node.js**: >= 20.0.0 (Recommended: 22.17.0)
- **pnpm**: For package management.
- **MIDL Regtest BTC**: Required for deployment and transaction fees on the staging network.

## Getting Started

1. **Installation**:
   ```bash
   pnpm install
   ```

2. **Configuration**:
   Copy the example environment file and add your mnemonic:
   ```bash
   cp .env.example .env
   # Edit .env and set MNEMONIC="your mnemonic here"
   ```

3. **Running Tests**:
   Verify everything is working with the comprehensive test suite:
   ```bash
   pnpm hardhat test
   ```

4. **Deployment**:
   Deploy the HealthChain contract to the MIDL staging network:
   ```bash
   pnpm hardhat deploy
   ```

## Contract Overview (HealthChain.sol)

### HealthID (Encryption Keys)
- `registerEncryptionPubKey(string key)`: Link your public encryption key to your address.
- `getEncryptionPubKey(address user)`: Retrieve a user's registered public key.

### Health Records
- `registerRecord(string cid, string hash)`: Store metadata for an encrypted record on IPFS.
- `getRecord(uint256 id)`: (Owner only) Retrieve direct record details.

### Atomic Swaps
- `createOffer(uint256 recordId, uint256 price, bytes32 hashlock, uint256 expiration)`: Offer data for sale.
- `payForOffer(uint256 offerId, string pubKey)`: Requester places funds in escrow.
- `revealSecret(uint256 offerId, bytes32 secret)`: Owner reveals secret to claim funds and grant access.
- `reclaimPayment(uint256 offerId)`: Requester reclaims funds if owner fails to fulfill before expiration.
- `getAccessedRecordViaOffer(uint256 offerId)`: (Purchaser only) Access record data after successful swap.

## Network Information (Staging)

- **RPC URL**: `https://rpc.staging.midl.xyz`
- **Mempool Explorer**: [https://mempool.staging.midl.xyz](https://mempool.staging.midl.xyz)
- **Block Explorer**: [https://blockscout.staging.midl.xyz](https://blockscout.staging.midl.xyz)
- **Rune Provider**: `https://runes.staging.midl.xyz`

