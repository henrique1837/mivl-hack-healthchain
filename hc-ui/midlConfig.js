import {
    createConfig,
    regtest,
} from "@midl/core";
import { xverseConnector } from "@midl/connectors";

export const midlConfig = createConfig({
    networks: [regtest],
    connectors: [xverseConnector()],
    persist: true,
});