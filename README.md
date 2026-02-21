# HealthDataSwap 🏥⛓️

HealthDataSwap is a decentralized platform designed to put patients in control of their medical data. By combining the scaling power of the **MIDL Network** (Bitcoin-backed EVM) with the censorship-resistant communication of **Nostr**, HealthDataSwap enables secure, trustless, and atomic exchanges of health records.

## 🌟 The Vision

Traditional health data is siloed and often inaccessible to the patients who own it. HealthDataSwap enables:
1.  **Sovereign Identity**: Use your Bitcoin/EVM wallet as your HealthID.
2.  **Privacy First**: All data is encrypted and stored on IPFS, with keys managed by the user.
3.  **Atomic Swaps**: Providers and requesters exchange funds for data access trustlessly using Hashed Time-Lock Contracts (HTLCs).

## 🏗️ Architecture

-   **[MIDL Network](https://midl.xyz)**: A high-performance Bitcoin scaling layer that provides the EVM environment for our `DataShareHTLC` contract.
-   **[Nostr](https://nostr.com)**: Used as a decentralized signaling layer for discovering users, sharing encrypted access requests, and returning decrypted health data pointers.
-   **IPFS**: Decentralized storage for encrypted health record payloads (to be implemented).

## 📂 Project Structure

-   **[`/hc-ui`](./hc-ui)**: The React-based frontend application. Built with Vite, Tailwind CSS, and the MIDL Executor SDK.
-   **[`/mivl-contracts`](./mivl-contracts)**: Smart contracts and testing suite for the atomic swap logic.

## 🚀 Getting Started

To get the full stack running locally:

1.  **Contracts**:
    ```bash
    cd mivl-contracts
    npm install
    npx hardhat test
    ```

2.  **UI**:
    ```bash
    cd hc-ui
    npm install
    npm run dev
    ```

## 📜 License
MIT
