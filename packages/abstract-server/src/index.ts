/**
 * abstract-server: юзкейсы и домен карты — решения 0014, 0015 и 0041.
 *
 * Среда приходит портами, поэтому сервер одинаково работает из редактора и из терминала.
 */
export const VERSION = "0.0.0";

export * from "./ports/index.ts";
export * from "./entry/server.ts";
export * from "./entry/mcp.ts";
export * from "./entry/mcp-requests.ts";
export * from "./entry/platform-file.ts";
export type { MapRef } from "./kernel/map-ref.ts";
export * from "./features/map/index.ts";
export * from "./features/directives/index.ts";
export * from "./features/components/index.ts";
export * from "./features/maps/index.ts";
export * from "./features/traces/index.ts";
export * from "./features/logs/index.ts";
export * from "./features/market/index.ts";
export * from "./features/directive-turns/index.ts";
export type { CheckStep, PluginCheck } from "./features/plugins/index.ts";
export { PLUGIN_INSTALL } from "./features/plugins/index.ts";
