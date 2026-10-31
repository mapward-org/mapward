import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createMapServer, serveMcp } from "@mapward/abstract-server";
import { createPorts } from "./ports.ts";

/**
 * Агент пишет карту методами — сквозь MCP по-настоящему: настоящий диск, настоящий esbuild в
 * WebAssembly, настоящие процессы плагинов. Объект, метрика по шаблону встроенного `views`,
 * экшон над изменяющим методом — с нуля, без единой записи файла мимо `edit_map`, — и `check`.
 */

let root = "";
const slash = (path: string) => path.replaceAll("\\", "/");

const files: Record<string, string> = {
  "map/_index.json": JSON.stringify({ name: "Корень" }),
  "map/_plugins/hello/index.ts": [
    'import { definePlugin } from "@mapward/plugin";',
    'import { of } from "rxjs";',
    "",
    "export default definePlugin({",
    "  methods: {",
    "    hello: {",
    '      params: { type: "object", required: ["name"], properties: { name: { type: "string" } } },',
    "      run: (args: { name: string }) => of(`привет, ${args.name}`),",
    "    },",
    '    bump: { kind: "mutation", run: () => of(1) },',
    "  },",
    "});",
  ].join("\n"),
};

const ref = () => ({ mapPath: `${root}/map`, basePath: root, name: "Корень" });

beforeAll(async () => {
  root = slash(await mkdtemp(join(tmpdir(), "mapward-edit-")));
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, text, "utf8");
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const server = () =>
  createMapServer({
    ...createPorts(),
    trust: { allow: async () => true, grant: async () => undefined },
  });

/** Инструмент MCP по-настоящему: ответ разбирается из текста, как его читает агент. */
async function mcp(
  map: ReturnType<typeof server>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let handler: ((message: unknown) => void) | undefined;
  const replies: { result?: { content: { text: string }[] }; error?: { message: string } }[] = [];
  serveMcp(map, [ref()], {
    onMessage: (next) => {
      handler = next;
      return () => undefined;
    },
    send: (message) => replies.push(message as (typeof replies)[number]),
  });
  handler?.({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  for (let tick = 0; tick < 1500 && replies.length === 0; tick++) {
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const reply = replies[0];
  if (reply?.error) throw new Error(reply.error.message);
  return JSON.parse(reply?.result?.content[0]?.text ?? "null") as Record<string, unknown>;
}

type Step = { title: string; status: string; lines: string[] };

test("агент пишет объект с метрикой и экшоном с нуля методами и проверяет их check", async () => {
  const map = server();
  const hello = "${{ mapward:// }}/_plugins/hello";
  try {
    // Шаблоны встроенного видны в самоописании.
    await mcp(map, "add_plugin", { name: "views" });
    const views = await mcp(map, "describe_plugin", { plugin: "_plugins/views" });
    expect(Object.keys(views.templates as object)).toEqual([
      "list",
      "tree",
      "link",
      "status",
      "text",
      "markdown",
    ]);

    const written = await mcp(map, "edit_map", {
      ops: [
        { op: "create", parent: "mapward://", folder: "greeter", content: { name: "Приветствия" } },
        {
          op: "set",
          address: "mapward://greeter/_metrics/greeting",
          content: {
            label: "Приветствие",
            plugin: "_plugins/views",
            template: "text",
            params: { source: { plugin: hello, method: "hello", params: { name: "агент" } } },
          },
        },
        {
          op: "set",
          address: "mapward://greeter/_actions/bump",
          content: { label: "Прибавить", plugin: hello, method: "bump" },
        },
        { op: "check", address: "mapward://greeter/_metrics/greeting" },
        { op: "check", address: "mapward://greeter/_actions/bump" },
      ],
    });
    expect(written).toMatchObject({ ok: true, created: [`mapward://greeter`] });
    const results = written.results as Record<string, unknown>[];
    expect(results[1]).toMatchObject({
      created: true,
      content: {
        component: "${{ mapward:// }}/_plugins/views/text.tsx",
        agent: { plugin: hello, method: "hello", params: { name: "агент" } },
      },
    });
    const metric = results[3] as { ok: boolean; steps: Step[] };
    expect(metric.ok).toBe(true);
    expect(metric.steps.map((step) => step.status)).toEqual(["ok", "ok"]);
    expect(metric.steps[1]?.lines).toEqual(['hello ответил: "привет, агент"']);
    expect(results[4]).toMatchObject({ ok: true });

    // Файлы легли туда, где их ждёт модель, — и карта их видит.
    expect(
      JSON.parse(await readFile(join(root, "map/greeter/_metrics/greeting/config.json"), "utf8")),
    ).toMatchObject({ label: "Приветствие" });
    const object = await mcp(map, "read_object", {
      address: "mapward://greeter",
      metrics: ["greeting"],
    });
    expect(object.name).toBe("Приветствия");

    // Ошибка поля — отказ с путём, а не запись; читающий метод экшону не годится.
    const refused = await mcp(map, "edit_map", {
      ops: [
        {
          op: "set",
          address: "mapward://greeter/_actions/bump",
          content: { plugin: hello, method: "hello" },
        },
      ],
    });
    expect(refused).toMatchObject({
      ok: false,
      errors: ["/method: hello читающий, а экшон зовёт изменяющий"],
    });

    // Свой компонент с ошибкой: запись проходит, а `check` называет файл и место.
    const broken = await mcp(map, "edit_map", {
      ops: [
        {
          op: "writeFile",
          path: "greeter/_metrics/broken/view.tsx",
          text: "export default function View() {\n  return (\n}\n",
        },
        {
          op: "set",
          address: "mapward://greeter/_metrics/broken",
          content: { label: "Сломанная", component: "./view.tsx" },
        },
        { op: "check", address: "mapward://greeter/_metrics/broken" },
      ],
    });
    const report = (broken.results as { ok: boolean; steps: Step[] }[])[2];
    expect(report?.ok).toBe(false);
    expect(report?.steps[0]?.lines.join("\n")).toMatch(/view\.tsx:\d+:\d+: /);
  } finally {
    await map.stopPlugins();
  }
}, 90_000);
