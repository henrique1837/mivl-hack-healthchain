import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { MidlProvider } from '@midl/react'
import { WagmiMidlProvider } from "@midl/executor-react"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { midlStore } from "./midlConfig"

const queryClient = new QueryClient()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MidlProvider config={midlStore}>
      <QueryClientProvider client={queryClient}>
        <WagmiMidlProvider>
          <App />
        </WagmiMidlProvider>
      </QueryClientProvider>
    </MidlProvider>
  </StrictMode>,
)
