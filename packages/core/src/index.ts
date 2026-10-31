/**
 * core: связка — то, что двум сторонам нужно понимать одинаково (решения 0014 и 0015): контракты
 * моста и протокол, типы того, что по ним едет, адреса и маленькие помощники над объектом.
 * Модель карту собирает только сервер — сборка живёт у него (`ru/docs/architecture/core.md`).
 *
 * Ни платформы, ни рантайма: это стережёт `tests/platform-independence.test.ts`. Что у каждого
 * модуля есть потребитель кроме сервера — `tests/core-is-a-link.test.ts`.
 */
export const VERSION = "0.0.0";

export * from "./contracts/bridge.ts";
export * from "./contracts/protocol.ts";
export * from "./contracts/map.ts";
export * from "./contracts/state.ts";
export * from "./contracts/turns.ts";
export * from "./contracts/runs.ts";
export * from "./contracts/config.ts";
export * from "./contracts/app.ts";
export * from "./contracts/plugins.ts";
export * from "./contracts/edit.ts";
export * from "./lib/bridge/client.ts";
export * from "./lib/bridge/server.ts";
export * from "./model/model.ts";
export * from "./model/configs.ts";
export * from "./model/address.ts";
export * from "./model/folders.ts";
export * from "./model/inputs.ts";
export * from "./model/git.ts";
