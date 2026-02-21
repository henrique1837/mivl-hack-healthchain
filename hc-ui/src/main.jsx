import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { MidlProvider } from '@midl/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { midlConfig, queryClient } from "./config";
import { NostrProvider } from './contexts/NostrContext'
import { SatoshiKitProvider } from "@midl/satoshi-kit";
import { WagmiMidlProvider } from "@midl/executor-react";
import "@midl/satoshi-kit/styles.css";

createRoot(document.getElementById('root')).render(
  <MidlProvider config={midlConfig}>
    <QueryClientProvider client={queryClient}>
      <WagmiMidlProvider>
        <SatoshiKitProvider>
          <NostrProvider>
            <App />
          </NostrProvider>
        </SatoshiKitProvider>
      </WagmiMidlProvider>
    </QueryClientProvider>
  </MidlProvider>,
)
