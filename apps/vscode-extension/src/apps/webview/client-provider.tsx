import type { ReactNode } from "react";
import { configBridge } from "../../kernel/bridge/config.ts";
import { ProviderBridgeClient } from "../../kernel/bridge/context.tsx";
import { createBridgeClient } from "../../shared/bridge/client.ts";
import { extensionTransport } from "../../shared/bridge/transport.ts";

const client = createBridgeClient(configBridge, extensionTransport());

export function BridgeProvider(props: { children: ReactNode }) {
  return <ProviderBridgeClient client={client}>{props.children}</ProviderBridgeClient>;
}
