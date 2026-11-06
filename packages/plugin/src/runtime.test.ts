import { defer, map, NEVER, Observable, of, Subject } from "rxjs";
import { Type } from "typebox";
import { expect, expectTypeOf, test } from "vitest";
import { definePlugin, resolveAddress, runPlugin } from "./runtime.ts";
import type { PlatformMessage, PluginMessage, TemplateParams } from "./types.ts";

/** Таймеры среды: у пакета их типов нет, а тесту они нужны. */
const { setTimeout } = globalThis as unknown as {
  setTimeout: (run: () => void, ms: number) => unknown;
};

const MAP = { name: "m", mapPath: "/repo/map", basePath: "/repo" };

/** Канал без процесса: что плагин отправил — в `sent`, что платформа сказала — `say`. */
function channel() {
  const sent: PluginMessage[] = [];
  const logs: string[] = [];
  let handler: ((message: PlatformMessage) => void) | undefined;
  let exited: number | undefined;
  return {
    sent,
    logs,
    exited: () => exited,
    io: {
      send: (message: PluginMessage) => sent.push(message),
      onMessage: (next: (message: PlatformMessage) => void) => {
        handler = next;
      },
      log: (text: string) => logs.push(text),
      exit: (code: number) => {
        exited = code;
      },
    },
    say: (message: PlatformMessage) => handler?.(message),
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 0));

test("рукопожатие отдаёт самоописание после init", async () => {
  const order: string[] = [];
  const io = channel();
  runPlugin(
    definePlugin({
      description: "граф",
      activation: { withMap: true },
      init: () => {
        order.push("init");
      },
      methods: {
        deps: { description: "зависимости", params: { type: "object" }, run: () => of(1) },
        rebuild: { kind: "mutation", run: () => of(true) },
      },
    }),
    io.io,
  );
  io.say({ t: "hello", map: MAP, pluginDir: "/repo/map/_plugins/g", isVscode: false });
  await tick();

  expect(order).toEqual(["init"]);
  expect(io.sent).toEqual([
    {
      t: "ready",
      description: {
        description: "граф",
        activation: { withMap: true },
        methods: {
          deps: { kind: "query", description: "зависимости", params: { type: "object" } },
          rebuild: { kind: "mutation" },
        },
      },
    },
  ]);
});

test("вызов отдаёт значения потока, отмена гасит его", async () => {
  let stopped = false;
  const ticks = new Subject<number>();
  const push = (value: number) => ticks.next(value);
  const io = channel();
  runPlugin(
    {
      methods: {
        ticks: {
          run: () =>
            new Observable<number>((subscriber) => {
              const subscription = ticks.subscribe(subscriber);
              return () => {
                subscription.unsubscribe();
                stopped = true;
              };
            }),
        },
      },
    },
    io.io,
  );
  io.say({ t: "hello", map: MAP, pluginDir: "/p", isVscode: false });
  await tick();
  io.say({ t: "call", id: "1", method: "ticks", args: {} });
  push(1);
  push(2);
  io.say({ t: "cancel", id: "1" });
  push(3);

  expect(io.sent.slice(1)).toEqual([
    { t: "next", id: "1", value: 1 },
    { t: "next", id: "1", value: 2 },
  ]);
  expect(stopped).toBe(true);
});

test("не observable и неизвестный метод — ошибка, а не тишина", async () => {
  const io = channel();
  runPlugin({ methods: { bad: { run: () => 5 as never } } }, io.io);
  io.say({ t: "hello", map: MAP, pluginDir: "/p", isVscode: false });
  await tick();
  io.say({ t: "call", id: "1", method: "bad", args: {} });
  io.say({ t: "call", id: "2", method: "nope", args: {} });

  expect(io.sent.slice(1)).toEqual([
    { t: "error", id: "1", message: "метод bad должен вернуть observable" },
    { t: "error", id: "2", message: "у плагина нет метода nope" },
  ]);
});

test("контекст: модель карты — просьбой к платформе, редактор — только с ним", async () => {
  const io = channel();
  const seen: unknown[] = [];
  runPlugin(
    {
      methods: {
        name: {
          run: (args: { address: string }, ctx) =>
            ctx.object(args.address).pipe(map((object) => object?.name)),
        },
        editor: {
          run: (_args: unknown, ctx) =>
            of(ctx.isVscode ? "есть" : Object.keys(ctx).includes("vscode")),
        },
        broken: { run: (_args: unknown, ctx) => defer(() => ctx.vscode.showMessage("x")) },
      },
    },
    io.io,
  );
  io.say({ t: "hello", map: MAP, pluginDir: "/p", isVscode: false });
  await tick();

  io.say({ t: "call", id: "1", method: "name", args: { address: "mapward://core" } });
  // Просьба из `ctx` вызова несёт его номер: платформа отдаёт ей трейс этого вызова.
  expect(io.sent.at(-1)).toEqual({
    t: "request",
    id: "r1",
    call: "1",
    op: "object",
    address: "mapward://core",
  });
  io.say({ t: "rnext", id: "r1", value: { name: "core" } });
  expect(io.sent.at(-1)).toEqual({ t: "next", id: "1", value: "core" });
  io.say({ t: "cancel", id: "1" });
  expect(io.sent.at(-1)).toEqual({ t: "release", id: "r1" });

  io.say({ t: "call", id: "2", method: "editor", args: {} });
  io.say({ t: "call", id: "3", method: "broken", args: {} });
  await tick();
  seen.push(
    ...io.sent.filter((message) => "id" in message && (message.id === "2" || message.id === "3")),
  );
  expect(seen).toEqual([
    { t: "next", id: "2", value: false },
    { t: "complete", id: "2" },
    { t: "error", id: "3", message: "редактора нет: платформа запущена без VS Code" },
  ]);
});

test("потоки ctx — rxjs: Observable той же копии и его операторы", async () => {
  const io = channel();
  let stream: unknown;
  runPlugin(
    {
      methods: {
        children: {
          run: (args: { address: string }, ctx) => {
            stream = ctx.children(args.address);
            return ctx.children(args.address).pipe(map((children) => children.length));
          },
        },
      },
    },
    io.io,
  );
  io.say({ t: "hello", map: MAP, pluginDir: "/p", isVscode: false });
  await tick();
  io.say({ t: "call", id: "1", method: "children", args: { address: "mapward://" } });
  expect(stream).toBeInstanceOf(Observable);
  const asked = io.sent.findLast((message) => message.t === "request");
  io.say({ t: "rnext", id: asked && "id" in asked ? asked.id : "", value: [{}, {}] });
  expect(io.sent.at(-1)).toEqual({ t: "next", id: "1", value: 2 });
});

test("аргументы проверяются по params до run: отказ с путём до поля", async () => {
  const io = channel();
  let ran = 0;
  runPlugin(
    definePlugin({
      methods: {
        hello: {
          params: Type.Object({ name: Type.String() }),
          run: (args) => {
            ran++;
            return of(`привет, ${args.name}`);
          },
        },
      },
    }),
    io.io,
  );
  io.say({ t: "hello", map: MAP, pluginDir: "/p", isVscode: false });
  await tick();
  io.say({ t: "call", id: "1", method: "hello", args: { name: 5 } });
  io.say({ t: "call", id: "2", method: "hello", args: { name: "мир" } });

  expect(io.sent.slice(1, 2)).toEqual([
    {
      t: "error",
      id: "1",
      message: expect.stringMatching(/^аргументы hello не по схеме: \/name: /),
    },
  ]);
  expect(io.sent.slice(2)).toEqual([
    { t: "next", id: "2", value: "привет, мир" },
    { t: "complete", id: "2" },
  ]);
  expect(ran).toBe(1);
});

test("definePlugin выводит типы из схем; без схемы — тип из подписи", () => {
  const plugin = definePlugin({
    methods: {
      greet: {
        params: Type.Object({ name: Type.String(), times: Type.Optional(Type.Number()) }),
        result: Type.String(),
        run: (args) => of(args.name.repeat(args.times ?? 1)),
      },
      literal: {
        params: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
        run: (args) => of(args.n + 1),
      },
      plain: { run: (args: { flag: boolean }) => of(args.flag) },
      live: { run: () => NEVER },
    },
  });
  type Methods = typeof plugin.methods;
  expectTypeOf<Parameters<Methods["greet"]["run"]>[0]>().toEqualTypeOf<{
    name: string;
    times?: number;
  }>();
  expectTypeOf<Parameters<Methods["literal"]["run"]>[0]>().toEqualTypeOf<{ n: number }>();
  expectTypeOf<Parameters<Methods["plain"]["run"]>[0]>().toEqualTypeOf<{ flag: boolean }>();
  expectTypeOf<ReturnType<Methods["greet"]["run"]>>().toEqualTypeOf<Observable<string>>();

  const views = definePlugin({
    templates: {
      list: {
        component: "list.tsx",
        params: Type.Object({ empty: Type.Optional(Type.String()) }),
      },
    },
    methods: {},
  });
  expectTypeOf<TemplateParams<typeof views, "list">>().toEqualTypeOf<{ empty?: string }>();

  definePlugin({
    methods: {
      // @ts-expect-error значения потока не сходятся с `result`
      wrong: { result: Type.String(), run: () => of(1) },
    },
  });
});

test("остановка: отписка, dispose, отчёт и выход", async () => {
  const order: string[] = [];
  const io = channel();
  runPlugin(
    {
      dispose: () => {
        order.push("dispose");
      },
      methods: {
        live: {
          run: () =>
            new Observable(() => () => {
              order.push("unsubscribe");
            }),
        },
      },
    },
    io.io,
  );
  io.say({ t: "hello", map: MAP, pluginDir: "/p", isVscode: false });
  await tick();
  io.say({ t: "call", id: "1", method: "live", args: {} });
  io.say({ t: "shutdown" });
  await tick();

  expect(order).toEqual(["unsubscribe", "dispose"]);
  expect(io.sent.at(-1)).toEqual({ t: "disposed" });
  expect(io.exited()).toBe(0);
});

test("адрес без решётки — путь, вычисляется без платформы", () => {
  expect(resolveAddress("mapward://packages/core", MAP)).toBe("/repo/map/packages/core");
  expect(resolveAddress("mapward://", MAP)).toBe("/repo/map");
  expect(resolveAddress("mapward://@/src/a.ts", MAP)).toBe("/repo/src/a.ts");
  expect(resolveAddress("mapward://~/docs", MAP, "mapward://packages/core")).toBe(
    "/repo/map/packages/core/docs",
  );
  expect(() => resolveAddress("mapward://core#props.name", MAP)).toThrow(/значение/);
});
