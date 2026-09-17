import { spawn } from "node:child_process";
import type { MapMetric, MapObject } from "../pure-model/model.ts";
import { objectEnv, parseAnswer, runAgent, shapeHint } from "./agent.ts";
import { writeCache, writeLogs, type Collected } from "./collect.ts";

/**
 * A collector returns what the source has; a display waits for its own shape. The transform
 * turns one into the other — decision 0004. Transforms run in order, the output of one is the
 * input of the next, and the first one gets whatever the collectors produced.
 *
 * A failed transform does not fail the metric: the previous value stays and the log says why.
 */

/** stdin in, stdout out — the script never sees a command line, so nothing needs quoting. */
function runScript(params: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, {
      cwd: params.cwd,
      env: params.env,
      windowsHide: true,
      shell: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (error) => reject(error));
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(stderr.trim() || `скрипт вернул ${String(code)}`)),
    );

    child.stdin.end(params.input);
  });
}

async function step(
  spec: Record<string, unknown>,
  input: unknown,
  owner: MapObject,
  cwd: string,
  displayKind: string | undefined,
): Promise<{ value: unknown; log?: string }> {
  const env = objectEnv(owner, cwd);
  const payload = JSON.stringify(input ?? null);

  switch (spec.kind) {
    case "script": {
      const { stdout, stderr } = await runScript({
        command: String(spec.run),
        cwd,
        env,
        input: payload,
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
      const { stdout, stderr } = await runAgent({ prompt, cwd, env });
      return { value: parseAnswer(stdout), log: stderr || undefined };
    }
    default:
      throw new Error(`Трансформ ${String(spec.kind)} ещё не поддержан`);
  }
}

export async function transform(
  metric: MapMetric,
  owner: MapObject,
  cwd: string,
  collected: Collected,
): Promise<Collected> {
  const specs = metric.config.transforms ?? [];
  if (specs.length === 0 || !collected.ok) return collected;

  const logs: string[] = [];
  let value = collected.data;

  try {
    for (const spec of specs) {
      // In order, each one fed by the last: that is what makes them a pipeline.
      // oxlint-disable-next-line no-await-in-loop
      const result = await step(spec, value, owner, cwd, metric.config.display?.kind);
      value = result.value;
      if (result.log) logs.push(result.log);
    }
  } catch (error) {
    await writeLogs(
      metric,
      "transform.logs.json",
      [...logs, error instanceof Error ? error.message : String(error)].join("\n"),
    );
    return { ...collected, ok: false };
  }

  if (logs.length > 0) await writeLogs(metric, "transform.logs.json", logs.join("\n"));

  const transformed: Collected = {
    updatedAt: new Date().toISOString(),
    ok: true,
    data: value,
  };
  if (metric.config.transformsCache) await writeCache(metric, "transform.json", transformed);
  return transformed;
}
