import * as T from "typebox";
import { createBridgeMethod } from "./bridge.ts";

/**
 * Two kinds of state, kept apart on purpose.
 *
 * `view` is a per-person convenience — which sections are folded, where the graph is panned.
 * It lives in the editor's workspaceState: nobody else needs it and it must not reach the
 * repository.
 *
 * `map` is what the map itself remembers — node positions. It belongs next to the map, in
 * `map-state.json`, so the whole team sees the same picture.
 */
export const stateBridge = {
  getViewState: createBridgeMethod(T.Object({ key: T.String() }), T.Unknown()),
  setViewState: createBridgeMethod(T.Object({ key: T.String(), value: T.Unknown() }), T.Void()),
  getMapState: createBridgeMethod(T.Object({ mapPath: T.String() }), T.Unknown()),
  setMapState: createBridgeMethod(T.Object({ mapPath: T.String(), value: T.Unknown() }), T.Void()),
};
