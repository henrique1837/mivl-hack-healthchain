import { regtest } from "@midl/core";
import { createMidlConfig } from "@midl/satoshi-kit";
import { QueryClient } from "@tanstack/react-query";
import { xverseConnector } from "@midl/connectors";

export const midlConfig = createMidlConfig({
    networks: [regtest],
    persist: true,
    connectors: [
        xverseConnector({
            metadata: {
                group: "popular",
            },
        }),
    ],
});

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
        },
    },
});