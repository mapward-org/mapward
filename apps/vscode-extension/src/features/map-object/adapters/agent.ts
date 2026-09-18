import { spawn } from "node:child_process";
import type { MapObject } from "../pure-model/model.ts";

/**
 * A metric may be collected by an agent — decision 0004. It runs headless: no terminal, no
 * conversation, one question and one answer. The prompt goes in through stdin rather than as
 * an argument, so quoting rules of three shells stop being our problem.
 */
const COMMAND = "claude";
const ARGS = ["-p"];

/**
 * `MAPWARD_OBJECT_PATH` is the path from the map root, as decision 0004 says — which makes it
 * the object's address without the scheme, and that is what a script needs to tell whose
 * requirement it is holding.
 */
function objectPath(owner: MapObject, mapPath: string): string {
  const path = owner.path.replaceAll("\\", "/");
  const root = mapPath.replaceAll("\\", "/");
  return path.startsWith(root) ? path.slice(root.length).replace(/^\/+/, "") : path;
}

/** Same environment a script collector gets: substitution cannot reach inside a prompt either. */
export function objectEnv(owner: MapObject, mapPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MAPWARD_MAP_PATH: mapPath,
    MAPWARD_OBJECT_PATH: objectPath(owner, mapPath),
    MAPWARD_OBJECT_NAME: owner.name,
    MAPWARD_OBJECT: JSON.stringify({ name: owner.name, props: owner.props }),
  };
}

export function runAgent(params: {
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(COMMAND, ARGS, {
      cwd: params.cwd,
      env: params.env,
      windowsHide: true,
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (error) => reject(error));
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(stderr.trim() || `${COMMAND} вернул ${String(code)}`)),
    );

    child.stdin.end(params.prompt);
  });
}

/**
 * An agent answers in prose unless asked otherwise, and even when asked it likes a fence. We
 * take the first json object or array we can parse; failing that the text itself is the answer,
 * which at least shows on a `text` display instead of an error.
 */
export function parseAnswer(raw: string): unknown {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]?.trim();
  const candidates = [fenced, text].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.search(/[{[]/);
      const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
      if (start === -1 || end <= start) continue;
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        continue;
      }
    }
  }

  return { text };
}

/** What the display expects, said to the agent — decision 0004: the shape it knows itself. */
export const SHAPES: Record<string, string> = {
  text: '{ "text": string }',
  link: '{ "label"?: string, "link"?: string }',
  status: '{ "ok": boolean, "summary"?: string }',
  list: '{ "items": [{ "label"?: string, "description"?: string, "link"?: string, "status"?: "fail" | "success" | "pending" | "idle", "hint"?: string }] }',
  tree: '{ "children": [{ "label"?: string, "description"?: string, "link"?: string, "status"?: string, "children"?: [...] }] }',
  map: '{ "nodes": [{ "label"?: string, "link"?: string }], "relations": [{ "from": string, "to": string, "label"?: string }] }',
};

export function shapeHint(kind: string | undefined): string {
  const shape = kind ? SHAPES[kind] : undefined;
  return shape
    ? `Ответь только json такой формы, без пояснений: ${shape}`
    : "Ответь только json, без пояснений";
}
