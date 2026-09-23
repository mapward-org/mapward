/**
 * abstract-react-client: интерфейс карты — решения 0014, 0015 и 0042.
 *
 * React и tailwind, одна кодовая база на все хосты. Платформа приходит портами, сервер виден
 * только через контракт `core`; состояние — сторы MobX.
 */
export const VERSION = "0.0.0";

export { MapwardApp, type TabTarget } from "./entry/app.tsx";
export { ObjectView } from "./entry/object-view.tsx";
export { ProviderBridgeClient, useBridgeClient } from "./ports/bridge.tsx";
export { ProviderIcons, useIcon, type RenderIcon } from "./ports/icons.tsx";
export { Maps } from "./features/maps/index.ts";
