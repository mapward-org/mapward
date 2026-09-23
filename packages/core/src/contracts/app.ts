import { createBridge } from "./bridge.ts";
import { configBridge } from "./config.ts";
import { directiveBridge, mapBridge, terminalBridge } from "./map.ts";
import { stateBridge } from "./state.ts";
import { turnsBridge } from "./turns.ts";

/** One channel for the whole app: features add methods, apps wires the handlers. */
export const appBridge = createBridge({
  ...configBridge,
  ...mapBridge,
  ...directiveBridge,
  ...terminalBridge,
  ...stateBridge,
  ...turnsBridge,
});

export type AppBridge = typeof appBridge;
