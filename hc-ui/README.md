# HealthDataSwap UI 📱

The frontend for the HealthDataSwap platform, providing a seamless interface for managing HealthIDs, recording medical data, and executing atomic swaps.

## ✨ Key Features

-   **HealthID Dashboard**: Connect your Bitcoin/EVM wallet (via Xverse) and automatically sync with your **Nostr** profile.
-   **Medical Records Management**: Store and encrypt links to your health data on IPFS.
-   **Atomic Access Requests**: Request and pay for data access using a secure HTLC flow powered by the MIDL network.
-   **Decrypted Data View**: Automatically decrypt and view medical records once a data swap is finalized.

## 🛠️ Technology Stack

-   **Framework**: [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
-   **Styling**: Vanilla CSS (Custom Glassmorphism Design)
-   **Wallet/Web3**: 
    -   [`@midl/executor-react`](https://docs.midl.xyz): MIDL SatoshiKit SDK for Bitcoin-backed EVM transactions.
    -   [`wagmi`](https://wagmi.sh) & [`viem`](https://viem.sh): For EVM contract interactions.
-   **Communication**: [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) for decentralized p2p signaling and coordination.

## 🚀 Development

### Prerequisites
- Node.js >= 20
- Xverse Wallet browser extension (configured for MIDL Regtest)

### Setup
1.  **Install dependencies**:
    ```bash
    npm install
    ```
2.  **Environment Variables**:
    Create a `.env` file or use defaults in `config.jsx`. Ensure the `HTLC_CONTRACT` address matches your deployment.
3.  **Run Dev Server**:
    ```bash
    npm run dev
    ```

## 🏗️ Folder Structure
-   `/src/components`: UI components including the `AccessRequestFlow` and `ChainGuard`.
-   `/src/contexts`: `NostrContext` for managing decentralized identity and DMs.
-   `/src/utils`: Contract ABIs and shared encryption utilities.

## 📜 License
MIT
