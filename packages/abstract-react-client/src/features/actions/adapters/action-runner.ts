import { actionForm } from "@mapward/core";
import type {
  ActionInput,
  AppBridge,
  BridgeClient,
  MapAction,
  RunSource,
  RunStarted,
} from "@mapward/core";

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

  /**
   * Поля формы: `inputs`, если написаны, иначе параметры метода по схеме из самоописания
   * плагина — та же форма, что проверит сервер. Схема уходит и сама — своей форме экшона.
   */
  async form(
    action: MapAction,
  ): Promise<{ fields: Record<string, ActionInput>; schema?: unknown }> {
    const { config } = action;
    if (config.inputs !== undefined || config.plugin === undefined) {
      return { fields: actionForm(config) };
    }
    const described = (await this.bridge.describePlugin({
      ...this.ref,
      plugin: config.plugin,
    })) as {
      methods?: Record<string, { params?: unknown } | undefined>;
    };
    const schema = described.methods?.[config.method ?? ""]?.params;
    return {
      fields: actionForm(config, schema),
      ...(schema === undefined ? {} : { schema }),
    };
  }

  async run(action: string, inputs: Record<string, unknown>, source: RunSource): Promise<Started> {
    try {
      return await this.bridge.runAction({ ...this.ref, action, inputs, source });
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  }
}
