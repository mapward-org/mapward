import type { ReactNode } from "react";
import { appBridge } from "@/kernel/bridge/app.ts";
import { ProviderBridgeClient } from "@/kernel/bridge/context.tsx";
import { createBridgeClient } from "@/shared/bridge/client.ts";
import { extensionTransport } from "@/shared/bridge/transport.ts";

const client = createBridgeClient(appBridge, extensionTransport());

export function BridgeProvider(props: { children: ReactNode }) {
  return <ProviderBridgeClient client={client}>{props.children}</ProviderBridgeClient>;
}
