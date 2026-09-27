import * as T from "typebox";
import { createBridgeMethod } from "./bridge.ts";

/**
 * Per-person state of the editor.
 *
 * `view` is a per-person convenience — which sections are folded, where the graph is panned.
 * It lives in the editor's workspaceState: nobody else needs it and it must not reach the
 * repository.
 *
 * What the map itself remembers — node positions, refs, shapes — is no longer state: it is the
 * view's `map-state.json` next to its metric, and it changes through map edits (decision 0044).
 */
export const stateBridge = {
  getViewState: createBridgeMethod(T.Object({ key: T.String() }), T.Unknown()),
  setViewState: createBridgeMethod(T.Object({ key: T.String(), value: T.Unknown() }), T.Void()),
};
