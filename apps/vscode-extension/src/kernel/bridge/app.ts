import { createBridge } from "@/shared/bridge/contract.ts";
import { configBridge } from "./config.ts";
import { mapBridge } from "./map.ts";

/** One channel for the whole app: features add methods, apps wires the handlers. */
export const appBridge = createBridge({ ...configBridge, ...mapBridge });

export type AppBridge = typeof appBridge;
