import * as T from "typebox";
import { createBridgeMethod, createBridgeSubscription } from "@/shared/bridge/contract.ts";

/** Which map to read: the sidebar may hold several at once. */
export const MapRef = T.Object({
  mapPath: T.String(),
  basePath: T.String(),
  name: T.String(),
});

/**
 * The map is a tree, and typebox cannot describe a recursive shape without ceremony. Params
 * are validated because they cross from the webview; results come from our own host code and
 * are typed on the client instead.
 */
export const mapBridge = {
  getMap: createBridgeMethod(MapRef, T.Unknown()),
  watchMap: createBridgeSubscription(MapRef, T.Unknown()),
  runMetric: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      metric: T.String(),
    }),
    T.Unknown(),
  ),
};

/** Creating a directive is a host job: it writes a file and opens it for editing. */
export const directiveBridge = {
  createDirective: createBridgeMethod(
    T.Object({ objectPath: T.String() }),
    T.Object({ path: T.String() }),
  ),
};

/** Terminals are the agent's sessions; the sidebar only asks the host to open or close one. */
export const terminalBridge = {
  openObjectTerminal: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      fresh: T.Optional(T.Boolean()),
    }),
    T.Object({ name: T.String() }),
  ),
  runDirective: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      directive: T.String(),
      mode: T.Union([T.Literal("check"), T.Literal("dry-run"), T.Literal("run")]),
      fresh: T.Optional(T.Boolean()),
    }),
    T.Object({ name: T.String() }),
  ),
  listTerminals: createBridgeMethod(
    T.Object({ address: T.String() }),
    T.Array(T.Object({ name: T.String() })),
  ),
  closeTerminal: createBridgeMethod(T.Object({ name: T.String() }), T.Void()),
};
