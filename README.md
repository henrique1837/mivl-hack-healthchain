# HealthDataSwap 🏥⛓️

HealthDataSwap is a decentralized platform designed to put patients in control of their medical data. By combining the scaling power of the **MIDL Network** (Bitcoin-backed EVM) with the censorship-resistant communication of **Nostr**, HealthDataSwap enables secure, trustless, and atomic exchanges of health records.

## 🌟 The Vision

Traditional health data is siloed and often inaccessible to the patients who own it. HealthDataSwap enables:
1.  **Sovereign Identity**: Use your Bitcoin/EVM wallet as your HealthID.
2.  **Privacy First**: All data is encrypted and stored on IPFS (to be implemented IPFS storage, using nostr only for this poc), with keys managed by the user.
3.  **Atomic Swaps**: Providers and requesters exchange funds for data access trustlessly using Hashed Time-Lock Contracts (HTLCs).

## 🏗️ Architecture

-   **[MIDL Network](https://midl.xyz)**: A high-performance Bitcoin scaling layer that provides the EVM environment for our `DataShareHTLC` contract.
-   **[Nostr](https://nostr.com)**: Used as a decentralized signaling layer for discovering users, sharing encrypted access requests, returning decrypted health data pointers, and for this POC, mocking IPFS storage.
-   **IPFS (Planned)**: Decentralized storage for encrypted health record payloads. *(Note: For this Hackathon POC, IPFS is mocked by storing the AES-GCM encrypted payloads directly on Nostr as public Kind-1 events - Kind can be changed in future, but for this PoC we kept kind 1 for simplicity. In a production app, real IPFS is required to support large files like PDFs, X-Rays, and Photos).*

## 📂 Project Structure

-   **[`/hc-ui`](./hc-ui)**: The React-based frontend application. Built with Vite, Tailwind CSS, and the MIDL Executor SDK.
-   **[`/mivl-contracts`](./mivl-contracts)**: Smart contracts and testing suite for the atomic swap logic.

## 🔄 How It Works (User Flows)

### The Data Requester (Doctor/Researcher)
1. **Discover**: The Requester browses the User Directory and finds public `health_record` CIDs on a Provider's profile.
2. **Setup Swap**: The Requester generates a random **secret** and hashes it. They create an on-chain **Hashed Time-Lock Contract (HTLC)** locking their EVM funds using this hash.
3. **Request Access**: The Requester sends a direct, encrypted Nostr DM to the Provider containing the access request along with the raw **secret**.

### The Data Provider (Patient)
1. **Upload**: Users encrypt their health records locally (AES-GCM derived from their Nostr public key) and publish them as public Kind-1 Nostr events. *(Note: This perfectly simulates IPFS for this POC. In production, this data would be uploaded to an actual IPFS node so it can handle large files like PDFs or photos).* The resulting CID is linked to their profile.
2. **Review Request**: The Provider receives the Requester's DM, verifying the on-chain HTLC lock matches the provided secret.
3. **Deliver Data**: The Provider uses the Requester's **secret** to symmetrically encrypt their health data pointers (and their public key). They send this encrypted package back via Nostr DM.
4. **Claim Funds**: The Provider submits the Requester's **secret** to the EVM HTLC contract on-chain to claim the locked funds.
5. **Decrypt**: The Requester uses their original **secret** to decrypt the Provider's response DM, retrieves the Provider's public key, and loads the full health data from the public Nostr events (IPFS simulation).

## 🚀 Getting Started

To get the full stack running locally:

1.  **Contracts**:
    ```bash
    cd mivl-contracts
    pnpm install
    pnpm hardhat test
    ```

    Deployment: https://blockscout.staging.midl.xyz/address/0x2cF31938497C52d196182b29fF7D64e5E3930E43
    

2.  **UI**:
    ```bash
    cd hc-ui
    pnpm install
    pnpm run dev
    ```

## 📜 License
MIT
