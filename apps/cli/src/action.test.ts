import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createMapServer, serveMcp, type McpTransport } from "@mapward/abstract-server";
import type { Run } from "@mapward/core";
import { createPorts } from "./ports.ts";

/**
 * Экшон целиком: карта во временной папке, `run_action` по MCP, встроенный плагин `shell`
 * доставляется в карту сам, собирается настоящим esbuild и запускается настоящим node. История
 * прогона ложится в `.mapward/runs`.
 */

let root = "";
const slash = (path: string) => path.replaceAll("\\", "/");

const files: Record<string, string> = {
  "map/_index.json": JSON.stringify({ name: "Корень" }),
  "map/core/_index.json": JSON.stringify({ name: "core", props: { title: "ядро" } }),
  // Метод плагина со своей формой: данные формы — полем `inputs`, объект — подстановкой.
  "map/core/_actions/greet/config.json": JSON.stringify({
    label: "Поздороваться",
    inputs: { name: { type: "string", required: true } },
    plugin: "../../../_plugins/shell",
    method: "run",
    params: {
      command: "node -e \"console.log('привет, ${{ inputs.name }}, ' + process.env.OBJECT_NAME)\"",
      env: { OBJECT_NAME: "${{ mapward://~#name }}" },
    },
  }),
  // Без своей формы: форма — схема метода без заданного.
  "map/core/_actions/where/config.json": JSON.stringify({
    label: "Где я",
    plugin: "../../../_plugins/shell",
    method: "run",
    params: { command: "node -e \"console.log(require('path').basename(process.cwd()))\"" },
  }),
};

beforeAll(async () => {
  root = slash(await mkdtemp(join(tmpdir(), "mapward-action-")));
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, text, "utf8");
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** Доверие спрашивают у человека; в тесте отвечает сам тест — и `~/.mapward` не трогается. */
function server(granted: string[]) {
  return createMapServer({
    ...createPorts(),
    trust: {
      allow: async ({ plugin }) => granted.includes(plugin),
      grant: async ({ plugin }) => {
        granted.push(plugin);
      },
    },
  });
}

/** MCP поверх сервера: инструмент и его ответ разобранным. */
function mcp(map: ReturnType<typeof server>) {
  let handler: ((message: unknown) => void) | undefined;
  const waiting = new Map<number, (reply: Record<string, unknown>) => void>();
  const transport: McpTransport = {
    onMessage: (next) => {
      handler = next;
      return () => undefined;
    },
    send: (message) => {
      const reply = message as Record<string, unknown>;
      waiting.get(Number(reply.id))?.(reply);
    },
  };
  serveMcp(map, [{ mapPath: `${root}/map`, basePath: root, name: "Корень" }], transport);
  let counter = 0;
  return (name: string, args: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++counter;
      waiting.set(id, (reply) => {
        if (reply.error) {
          reject(new Error(String((reply.error as { message?: string }).message)));
          return;
        }
        const content = (reply.result as { content: { text: string }[] }).content;
        resolve(JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>);
      });
      handler?.({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    });
}

test("run_action: an action runs through the built-in shell and lands in the history", async () => {
  const granted: string[] = [];
  const map = server(granted);
  const call = mcp(map);
  try {
    // Поля проверяет сервер: прогона нет.
    await expect(call("run_action", { address: "mapward://core/_actions/greet" })).rejects.toThrow(
      /name: обязательное поле/,
    );

    const run = (await call("run_action", {
      address: "mapward://core/_actions/greet",
      inputs: { name: "мир" },
    })) as unknown as Run;

    expect(run).toMatchObject({ status: "success", source: "mcp", inputs: { name: "мир" } });
    expect(run.steps.map((step) => [step.name, step.status])).toEqual([["shell.run", "success"]]);
    expect(run.steps[0]?.output).toBe("привет, мир, core\n");
    expect(run.result).toEqual({ code: 0 });
    // Встроенный плагин доставлен в карту сам и уже доверен.
    expect(granted).toEqual([`${root}/map/_plugins/shell`]);

    // read_run — тот же прогон по номеру; история лежит на диске карты.
    expect(await call("read_run", { id: run.id })).toMatchObject({ id: run.id, status: "success" });
    const saved = JSON.parse(
      await readFile(join(root, "map/.mapward/runs/core.json"), "utf8"),
    ) as Run[];
    expect(saved.map((entry) => entry.id)).toEqual([run.id]);

    // Экшон над методом: форма — параметры метода, заданное в params в ней не нужно.
    const where = (await call("run_action", {
      address: "mapward://core/_actions/where",
    })) as unknown as Run;
    expect(where.status).toBe("success");
    // Рабочая папка `shell` по умолчанию — папка карты.
    expect(where.steps[0]?.output).toBe("map\n");
  } finally {
    await map.stopPlugins();
  }
}, 60_000);
