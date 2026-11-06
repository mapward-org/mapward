import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createMapServer, serveMcp, type McpTransport } from "@mapward/abstract-server";
import type { LogLine, Run } from "@mapward/core";
import { createPorts } from "./ports.ts";

/**
 * Экшон целиком: карта во временной папке, `run_action` по MCP, встроенный плагин `shell`
 * доставляется в карту сам, собирается настоящим esbuild и запускается настоящим node. Прогон
 * своего хранилища не имеет: он — строки трейса в `.mapward/logs`, и собирается из них.
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

    // read_run — тот же прогон по номеру, собранный из строк его трейса.
    expect(await call("read_run", { id: run.id })).toMatchObject({ id: run.id, status: "success" });

    // Экшон над методом: форма — параметры метода, заданное в params в ней не нужно.
    const where = (await call("run_action", {
      address: "mapward://core/_actions/where",
    })) as unknown as Run;
    expect(where.status).toBe("success");
    // Рабочая папка `shell` по умолчанию — папка карты.
    expect(where.steps[0]?.output).toBe("map\n");

    // Логи — на диске карты: начало и конец трейса — в `mapward.log`, вызов и его вывод — в файле
    // плагина, с тем же трейсом и объектом. Остановка платформы дописывает накопленное.
    await map.stopPlugins();
    const read = async (file: string) =>
      (await readFile(join(root, `map/.mapward/logs/${file}.log`), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as LogLine);
    const platform = await read("mapward");
    expect(platform.filter((line) => line.trace === run.id).map((line) => line.kind)).toEqual([
      "trace-start",
      "trace-end",
    ]);
    // Вход MCP — строкой на каждый вызов инструмента.
    expect(platform.some((line) => line.kind === "mcp" && line.method === "run_action")).toBe(true);
    const shell = (await read("shell")).filter((line) => line.trace === run.id);
    expect(shell.map((line) => [line.kind, line.text ?? line.status])).toEqual([
      ["call-start", undefined],
      ["out", "привет, мир, core"],
      ["call-end", "success"],
    ]);
    expect(shell.every((line) => line.object === "mapward://core")).toBe(true);
  } finally {
    await map.stopPlugins();
  }
}, 60_000);
