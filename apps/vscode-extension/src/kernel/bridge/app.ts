import { createBridge } from "@/shared/bridge/contract.ts";
import { configBridge } from "./config.ts";
import { directiveBridge, mapBridge } from "./map.ts";
import { stateBridge } from "./state.ts";

/** One channel for the whole app: features add methods, apps wires the handlers. */
export const appBridge = createBridge({
  ...configBridge,
  ...mapBridge,
  ...directiveBridge,
  ...stateBridge,
});

export type AppBridge = typeof appBridge;
