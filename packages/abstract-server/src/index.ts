/**
 * abstract-server: юзкейсы и домен карты — решения 0014, 0015 и 0041.
 *
 * Среда приходит портами, поэтому сервер одинаково работает из редактора и из терминала.
 */
export const VERSION = "0.0.0";

export * from "./ports/index.ts";
export * from "./entry/server.ts";
export * from "./entry/mcp.ts";
export type { MapRef } from "./kernel/map-ref.ts";
export { defaultStages } from "./kernel/default-workflow.ts";
export * from "./features/map/index.ts";
export * from "./features/metrics/index.ts";
export * from "./features/directives/index.ts";
export * from "./features/displays/index.ts";
export * from "./features/execution/index.ts";
export * from "./features/maps/index.ts";
export * from "./features/action-runs/index.ts";
export * from "./features/directive-turns/index.ts";
export * from "./ports/agent-args.ts";
