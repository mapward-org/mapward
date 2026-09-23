/**
 * core: то, что серверу и клиенту нужно понимать одинаково — решения 0014 и 0015.
 *
 * Контракт вызовов и подписок, модель карты и адресация. Ни платформы, ни рантайма: это
 * стережёт `tests/platform-independence.test.ts`.
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
export * from "./lib/bridge/client.ts";
export * from "./lib/bridge/server.ts";
export * from "./model/model.ts";
export * from "./model/address.ts";
export * from "./model/schema.ts";
export * from "./model/children.ts";
export * from "./model/display.ts";
export * from "./model/inputs.ts";
export * from "./model/merge.ts";
export * from "./model/substitution.ts";
export * from "./model/anchor-display.ts";
export * from "./model/raw-object.ts";
export * from "./model/inherit.ts";
export * from "./model/default-workflow.ts";
export * from "./live/index.ts";
