import { createContext, type ReactNode, useContext } from "react";
import type { BridgeClient } from "@mapward/core";
import type { AppBridge } from "@mapward/core";

const BridgeContext = createContext<BridgeClient<AppBridge> | undefined>(undefined);

export function ProviderBridgeClient(props: {
  client: BridgeClient<AppBridge>;
  children: ReactNode;
}) {
  return <BridgeContext value={props.client}>{props.children}</BridgeContext>;
}

/** Features reach the host only through here — nothing below apps builds its own transport. */
export function useBridgeClient(): BridgeClient<AppBridge> {
  const client = useContext(BridgeContext);
  if (!client) throw new Error("ProviderBridgeClient is missing above this component");
  return client;
}
