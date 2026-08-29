import { createContext, type ReactNode, useContext } from "react";
import type { BridgeClient } from "@/shared/bridge/contract.ts";
import type { ConfigBridge } from "./config.ts";

const BridgeContext = createContext<BridgeClient<ConfigBridge> | undefined>(undefined);

export function ProviderBridgeClient(props: {
  client: BridgeClient<ConfigBridge>;
  children: ReactNode;
}) {
  return <BridgeContext value={props.client}>{props.children}</BridgeContext>;
}

/** Features reach the host only through here — nothing below apps builds its own transport. */
export function useBridgeClient(): BridgeClient<ConfigBridge> {
  const client = useContext(BridgeContext);
  if (!client) throw new Error("ProviderBridgeClient is missing above this component");
  return client;
}
