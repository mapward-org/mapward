/**
 * abstract-server: юзкейсы и домен карты — решения 0014 и 0015.
 *
 * Среда приходит портами, поэтому сервер одинаково работает из редактора и из терминала.
 */
export const VERSION = "0.0.0";

export * from "./ports/index.ts";
export * from "./entry/server.ts";
export * from "./entry/mcp.ts";
export * from "./features/map-object/index.ts";
export * from "./features/maps/index.ts";
