import { midlRegtest } from "@midl/executor";
import { createConfig, http } from "wagmi";

export const wagmiConfig = createConfig({
    chains: [midlRegtest],
    transports: {
        [midlRegtest.id]: http(midlRegtest.rpcUrls.default.http[0]),
    },
});