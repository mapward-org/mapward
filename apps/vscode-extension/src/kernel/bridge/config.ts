import * as T from "typebox";
import type { Static } from "typebox";
import {
  createBridge,
  createBridgeMethod,
  createBridgeSubscription,
} from "@/shared/bridge/contract.ts";

/** One map, already resolved to absolute paths — the webview never touches the file system. */
export const ResolvedMap = T.Object({
  name: T.String(),
  mapPath: T.String(),
  basePath: T.String(),
  configPath: T.String(),
});

/**
 * Not an error but a state: the sidebar draws a different screen for each. Two kinds of
 * emptiness are told apart on purpose — with no folder open there is nowhere to write a
 * config, so only `no-config` can offer to create one.
 */
export const MapsState = T.Union([
  T.Object({ kind: T.Literal("maps"), maps: T.Array(ResolvedMap) }),
  T.Object({ kind: T.Literal("no-config") }),
  T.Object({ kind: T.Literal("no-workspace") }),
  T.Object({ kind: T.Literal("error"), message: T.String(), configPath: T.Optional(T.String()) }),
]);

export const configBridge = createBridge({
  getMaps: createBridgeMethod(T.Void(), MapsState),
  watchMaps: createBridgeSubscription(T.Void(), MapsState),
  createConfig: createBridgeMethod(T.Void(), MapsState),
  openPath: createBridgeMethod(T.Object({ path: T.String() }), T.Void()),
  pickFolder: createBridgeMethod(T.Void(), T.Void()),
});

export type ResolvedMap = Static<typeof ResolvedMap>;
export type MapsState = Static<typeof MapsState>;
export type ConfigBridge = typeof configBridge;
