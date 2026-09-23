import type { MapMetric, MapObject } from "@mapward/core";
import type { Cancellation, ClockPort, EnvPort } from "../../../../ports/index.ts";
import { objectEnv } from "../../../../kernel/object-env.ts";
import { parseAnswer } from "../../domain/answer.ts";
import type { MetricsDisplaySchema, MetricsExecutor } from "../../ports.ts";
import type { Builtins } from "../services/builtins.ts";
import type { Collected, MetricCache } from "../services/metric-cache.ts";
import { answerLog, type StageReport } from "./collect-metric.ts";

/**
 * A collector returns what the source has; a display waits for its own shape. The transform
 * turns one into the other — decision 0004. Transforms run in order, the output of one is the
 * input of the next, and the first one gets whatever the collectors produced.
 *
 * A failed transform does not fail the metric: the previous value stays and the log says why.
 */
export class TransformMetric {
  constructor(
    private readonly builtins: Builtins,
    private readonly cache: MetricCache,
    private readonly schema: MetricsDisplaySchema,
    private readonly executor: MetricsExecutor,
    private readonly env: EnvPort,
    private readonly clock: ClockPort,
  ) {}

  async run(
    metric: MapMetric,
    owner: MapObject,
    cwd: string,
    collected: Collected,
    cancel?: Cancellation,
    previous?: Collected,
    report?: StageReport,
  ): Promise<Collected> {
    const specs = metric.config.transforms ?? [];
    if (specs.length === 0 || !collected.ok) return collected;

    const logs: string[] = [];
    let value = collected.data;

    try {
      const hint = await this.schema.hint(metric.config.display);
      for (const spec of specs) {
        // In order, each one fed by the last: that is what makes them a pipeline.
        // oxlint-disable-next-line no-await-in-loop
        const result = await this.step(spec, value, owner, cwd, hint, cancel);
        value = result.value;
        if (result.log) logs.push(result.log);
      }
    } catch (error) {
      // Отменённый трансформ тоже ничего не оставляет после себя.
      if (cancel?.cancelled) throw error;

      const log = [...logs, error instanceof Error ? error.message : String(error)].join("\n");
      report?.(log);
      await this.cache.writeLogs(metric, "transform.logs.json", log);
      // Прошлое значение честнее сырых данных сбора: дисплей ждёт форму после трансформа,
      // и сырое он покажет как ошибку формы.
      return { ...(previous ?? collected), ok: false, updatedAt: this.clock.now() };
    }

    report?.(logs.join("\n"), value);
    if (logs.length > 0) {
      await this.cache.writeLogs(metric, "transform.logs.json", logs.join("\n"));
    }

    const transformed: Collected = { updatedAt: this.clock.now(), ok: true, data: value };
    if (metric.config.transformsCache) {
      await this.cache.write(metric, "transform.json", transformed);
    }
    return transformed;
  }

  private async step(
    spec: Record<string, unknown>,
    input: unknown,
    owner: MapObject,
    cwd: string,
    /** Что сказать агенту о форме ответа: форма дисплея или схема компонента (решение 0037). */
    hint: string,
    cancel?: Cancellation,
  ): Promise<{ value: unknown; log?: string }> {
    const env = objectEnv(owner, cwd, this.env.vars());
    const payload = JSON.stringify(input ?? null);

    // Третий вид рядом со `script` и `prompt`: тело в инструменте, конфиг называет его именем —
    // решение 0023. Ищется до `switch`: неизвестный `kind` по-прежнему ошибка, и это ниже.
    const builtin = this.builtins.step(String(spec.kind));
    if (builtin) return builtin.run(input);

    switch (spec.kind) {
      case "script": {
        // stdin in, stdout out — the script never sees a command line, so nothing needs quoting.
        const { stdout, stderr } = await this.executor.script({
          command: String(spec.run),
          cwd,
          env,
          input: payload,
          cancel,
        });
        const text = stdout.trim();
        try {
          return { value: JSON.parse(text), log: stderr || undefined };
        } catch {
          return { value: { text }, log: stderr || undefined };
        }
      }
      case "prompt": {
        // Usually there is no text to write: the display knows the shape, and the data speaks
        // for itself — decision 0004.
        const intro = spec.prompt ? `${String(spec.prompt)}\n\n` : "";
        const text = `${intro}${hint}\n\nДанные:\n${payload}`;
        const { stdout, stderr } = await this.executor.prompt({ text, cwd, env, cancel });
        return { value: parseAnswer(stdout), log: answerLog(stderr, stdout) };
      }
      default:
        throw new Error(`Трансформ ${String(spec.kind)} ещё не поддержан`);
    }
  }
}
