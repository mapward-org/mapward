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
