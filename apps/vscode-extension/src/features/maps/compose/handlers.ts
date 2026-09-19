import { configBridge } from "@mapward/core";
import type { BridgeHandlers } from "@mapward/core";
import { createConfig, openExternal, openPath, pickFolder } from "../adapters/editor.ts";
import { readMaps, watchMaps } from "../adapters/workspace.ts";

/** Wiring only: every line here names an adapter, none of them does the work itself. */
export function mapsHandlers(): BridgeHandlers<typeof configBridge> {
  return {
    getMaps: () => readMaps(),
    watchMaps: () => watchMaps(),
    createConfig: () => createConfig(),
    pickFolder: () => pickFolder(),
    openPath: (params) => openPath(params),
    openExternal: (params) => openExternal(params),
  };
}
