import { createConfig, regtest } from '@midl/core';
import { xverseConnector } from '@midl/connectors';

// Correct initialization using @midl/core.createConfig 
// which creates the Zustand store required by MidlProvider
export const midlStore = createConfig({
    networks: [regtest],
    connectors: [
        xverseConnector({
            payload: {
                network: {
                    type: 'Testnet',
                },
            },
        }),
    ],
});
