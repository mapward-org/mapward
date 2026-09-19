import type { MapMetric, MapObject } from "@mapward/core";
import type { Cancellation, ServerPorts } from "../../../../ports/index.ts";
import { shapeHint } from "@mapward/core";
import { objectEnv, parseAnswer } from "../../domain/agent.ts";
import { writeCache, writeLogs, type Collected } from "./collect.ts";

/**
 * A collector returns what the source has; a display waits for its own shape. The transform
 * turns one into the other — decision 0004. Transforms run in order, the output of one is the
 * input of the next, and the first one gets whatever the collectors produced.
 *
 * A failed transform does not fail the metric: the previous value stays and the log says why.
 */
async function step(
  ports: ServerPorts,
  spec: Record<string, unknown>,
  input: unknown,
  owner: MapObject,
  cwd: string,
  displayKind: string | undefined,
  cancel?: Cancellation,
): Promise<{ value: unknown; log?: string }> {
  const env = objectEnv(owner, cwd, ports.env.vars());
  const payload = JSON.stringify(input ?? null);

  switch (spec.kind) {
    case "script": {
      // stdin in, stdout out — the script never sees a command line, so nothing needs quoting.
      const { stdout, stderr } = await ports.shell.pipe(String(spec.run), {
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
      const prompt = `${intro}${shapeHint(displayKind)}\n\nДанные:\n${payload}`;
      const { stdout, stderr } = await ports.agent.run({ prompt, cwd, env, cancel });
      return { value: parseAnswer(stdout), log: stderr || undefined };
    }
    default:
      throw new Error(`Трансформ ${String(spec.kind)} ещё не поддержан`);
  }
}

export async function transform(
  ports: ServerPorts,
  metric: MapMetric,
  owner: MapObject,
  cwd: string,
  collected: Collected,
  cancel?: Cancellation,
  previous?: Collected,
): Promise<Collected> {
  const specs = metric.config.transforms ?? [];
  if (specs.length === 0 || !collected.ok) return collected;

  const logs: string[] = [];
  let value = collected.data;

  try {
    for (const spec of specs) {
      // In order, each one fed by the last: that is what makes them a pipeline.
      // oxlint-disable-next-line no-await-in-loop
      const result = await step(
        ports,
        spec,
        value,
        owner,
        cwd,
        metric.config.display?.kind,
        cancel,
      );
      value = result.value;
      if (result.log) logs.push(result.log);
    }
  } catch (error) {
    // Отменённый трансформ тоже ничего не оставляет после себя.
    if (cancel?.cancelled) throw error;

    await writeLogs(
      ports.files,
      metric,
      "transform.logs.json",
      [...logs, error instanceof Error ? error.message : String(error)].join("\n"),
    );
    // Прошлое значение честнее сырых данных сбора: дисплей ждёт форму после трансформа,
    // и сырое он покажет как ошибку формы.
    return { ...(previous ?? collected), ok: false, updatedAt: ports.clock.now() };
  }

  if (logs.length > 0) {
    await writeLogs(ports.files, metric, "transform.logs.json", logs.join("\n"));
  }

  const transformed: Collected = { updatedAt: ports.clock.now(), ok: true, data: value };
  if (metric.config.transformsCache) {
    await writeCache(ports.files, metric, "transform.json", transformed);
  }
  return transformed;
}
