/**
 * abstract-react-client: интерфейс карты — решения 0014 и 0015.
 *
 * React и tailwind, одна кодовая база на все хосты. Платформа приходит портами, сервер виден
 * только через контракт `core`.
 */
export const VERSION = "0.0.0";

export { MapwardApp } from "./entry/app.tsx";
export { ProviderBridgeClient, useBridgeClient } from "./ports/bridge.tsx";
export { ProviderIcons, useIcon, type RenderIcon } from "./ports/icons.tsx";
export { Maps } from "./features/maps/index.ts";
export { MapObjectView } from "./features/map-object/index.ts";
