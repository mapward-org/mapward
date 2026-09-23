import type { AppBridge, BridgeClient, RunSource, RunStarted } from "@mapward/core";

type Ref = { mapPath: string; basePath: string; name: string };

/** Ответ на запуск: номер прогона или ошибки полей; сервер отказал целиком — `failed`. */
export type Started = RunStarted & { failed?: string };

/**
 * Запуск экшона через мост — решение 0038. Ответ приходит сразу, до конца прогона: номер или
 * ошибки полей. Сервер может и отказать целиком (экшона нет) — тогда это ошибка одной строкой,
 * а не упавший промис: форма её покажет.
 */
export class ActionRunner {
  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly ref: Ref,
  ) {}

  async run(action: string, inputs: Record<string, unknown>, source: RunSource): Promise<Started> {
    try {
      return await this.bridge.runAction({ ...this.ref, action, inputs, source });
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  }
}
