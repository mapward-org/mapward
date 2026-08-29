import type { ConfigBridge } from "@/kernel/bridge/config.ts";
import type { BridgeHandlers } from "@/shared/bridge/contract.ts";
import { createConfig, openPath, pickFolder } from "../adapters/editor.ts";
import { readMaps, watchMaps } from "../adapters/workspace.ts";

/** Wiring only: every line here names an adapter, none of them does the work itself. */
export function mapsHandlers(): BridgeHandlers<ConfigBridge> {
  return {
    getMaps: () => readMaps(),
    watchMaps: () => watchMaps(),
    createConfig: () => createConfig(),
    pickFolder: () => pickFolder(),
    openPath: (params) => openPath(params),
  };
}
