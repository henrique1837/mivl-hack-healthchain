# HealthDataSwap UI 📱

The frontend for the HealthDataSwap platform, providing a seamless interface for managing HealthIDs, recording medical data, and executing atomic swaps.

## ✨ Key Features

-   **HealthID Dashboard**: Connect your Bitcoin/EVM wallet (via Xverse) and automatically sync with your **Nostr** profile.
-   **Medical Records Management**: Store and encrypt links to your health data. *(Currently mocked on Nostr, planned for IPFS).*
-   **Atomic Access Requests**: Request and pay for data access using a secure HTLC flow powered by the MIDL network.
-   **Decrypted Data View**: Automatically decrypt and view medical records once a data swap is finalized.

## 🛠️ Technology Stack

-   **Framework**: [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
-   **Styling**: Vanilla CSS (Custom Glassmorphism Design)
-   **Wallet/Web3**: 
    -   [`@midl/executor-react`](https://docs.midl.xyz): MIDL SatoshiKit SDK for Bitcoin-backed EVM transactions.
    -   [`wagmi`](https://wagmi.sh) & [`viem`](https://viem.sh): For EVM contract interactions.
-   **Communication**: [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) for decentralized p2p signaling and coordination.

## 🔄 User Flow & Mechanics

The frontend orchestrates a complex interaction between Nostr (for decentralized identity and messaging) and the MIDL EVM network (for payments):

### 1. Data Requester Flow
- **Directory Discovery:** Requesters browse the `UsersDirectory.jsx` to find patients willing to share data.
- **Outgoing Requests:** In `AccessRequestFlow.jsx`, the requester generates a random HTLC secret, locks their EVM funds with its hash, and sends the raw secret to the provider via an encrypted Nostr DM request.
- **Decryption:** They wait in `OutgoingRequests.jsx` for the provider to respond. Once the provider replies, the requester uses their exact same secret to decrypt the DM, receiving the IPFS CIDs and the provider's public key, which are finally used to decode the raw IPFS data.

### 2. Data Provider Flow
- **Data Upload:** The `/src/components/HealthDataUpload.jsx` component encrypts patient data locally using AES-GCM and publishes it, linking the CID to the patient's Nostr Identity. **Note regarding IPFS**: For this Hackathon POC, IPFS is not fully implemented. We are mocking IPFS by storing the AES-GCM encrypted payload as a public Kind-1 Nostr event. In a real production application, IPFS must be used to accommodate large files (PDFs, photos, etc.), acting as the decentralized storage layer while Nostr handles the CID signaling.
- **Incoming Requests:** Providers monitor `IncomingRequests.jsx` for access DMs containing the requester's secret. When accepted, they use that secret to encrypt their health data pointers, send the response DM via `sendEncryptedDM`, and claim the payment on-chain using the secret!

## 🚀 Development

### Prerequisites
- Node.js >= 20
- Xverse Wallet browser extension (configured for MIDL Regtest)
- pnpm package manager

### Setup
1.  **Install dependencies**:
    ```bash
    pnpm install
    ```
2.  **Environment Variables**:
    Create a `.env` file or use defaults in `config.jsx`. Ensure the `HTLC_CONTRACT` address matches your deployment.
3.  **Run Dev Server**:
    ```bash
    pnpm run dev
    ```

## 🏗️ Folder Structure
-   `/src/components`: UI components including the `AccessRequestFlow` and `ChainGuard`.
-   `/src/contexts`: `NostrContext` for managing decentralized identity and DMs.
-   `/src/utils`: Contract ABIs and shared encryption utilities.

## 📜 License
MIT
