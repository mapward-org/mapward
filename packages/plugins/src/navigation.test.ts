import { expect, test } from "vitest";
import { runPlugin } from "@mapward/plugin";
import type { PlatformMessage, PluginMessage } from "@mapward/plugin";
import navigation from "../registry/navigation/index.ts";

/**
 * Навигация тем же рантаймом, что в процессе, против поддельного канала: платформа здесь —
 * тест, и на просьбы к редактору он отвечает сам, записывая, о чём просили.
 */

const MAP = { name: "m", mapPath: "/repo/map", basePath: "/repo" };

function plugin(isVscode: boolean) {
  const sent: PluginMessage[] = [];
  const editor: { method: string; args: unknown[] }[] = [];
  let handler: ((message: PlatformMessage) => void) | undefined;
  const say = (message: PlatformMessage) => handler?.(message);
  runPlugin(navigation, {
    send: (message) => {
      sent.push(message);
      // Редактор отвечает сразу, как ответила бы платформа.
      if (message.t === "request" && message.op === "vscode") {
        editor.push({ method: message.method, args: message.args });
        queueMicrotask(() => {
          say({ t: "rnext", id: message.id, value: null });
          say({ t: "rcomplete", id: message.id });
        });
      }
    },
    onMessage: (next) => {
      handler = next;
    },
    log: () => {},
    exit: () => {},
  });
  say({ t: "hello", map: MAP, pluginDir: "/repo/map/_plugins/navigation", isVscode });

  let counter = 0;
  /** Вызов `open` до ответа: значение или текст ошибки. */
  const open = async (args: { link: string; line?: number }) => {
    const id = `c${++counter}`;
    say({ t: "call", id, method: "open", args });
    for (let tick = 0; tick < 50; tick++) {
      const done = sent.find(
        (message) => (message.t === "next" || message.t === "error") && message.id === id,
      );
      if (done?.t === "next") return { value: done.value };
      if (done?.t === "error") return { error: done.message };
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("плагин не ответил");
  };
  return { open, editor };
}

test("mapward:// — объект: ответ зовущему, редактор не трогается", async () => {
  const { open, editor } = plugin(true);

  expect(await open({ link: "mapward://packages/core" })).toEqual({
    value: { kind: "object", address: "mapward://packages/core" },
  });
  expect(editor).toEqual([]);
});

test("файл — в редакторе: абсолютный как есть, относительный и mapward://@ — от корня проекта", async () => {
  const { open, editor } = plugin(true);

  expect(await open({ link: "/repo/src/a.ts", line: 3 })).toEqual({
    value: { kind: "file", path: "/repo/src/a.ts" },
  });
  expect(await open({ link: "src/b.ts" })).toEqual({
    value: { kind: "file", path: "/repo/src/b.ts" },
  });
  expect(await open({ link: "mapward://@/c.ts" })).toEqual({
    value: { kind: "file", path: "/repo/c.ts" },
  });
  expect(editor).toEqual([
    { method: "openFile", args: ["/repo/src/a.ts", { line: 3 }] },
    { method: "openFile", args: ["/repo/src/b.ts", {}] },
    { method: "openFile", args: ["/repo/c.ts", {}] },
  ]);
});

test("http(s) — через vscode.open", async () => {
  const { open, editor } = plugin(true);

  expect(await open({ link: "https://example.com/x" })).toEqual({
    value: { kind: "url", url: "https://example.com/x" },
  });
  expect(editor).toEqual([
    { method: "executeCommand", args: ["vscode.open", "https://example.com/x"] },
  ]);
});

test("без редактора файл и адрес — ошибка с понятным текстом, объект — по-прежнему ответ", async () => {
  const { open } = plugin(false);

  expect(await open({ link: "src/a.ts" })).toEqual({
    error: "редактора нет: открыть файл src/a.ts некому",
  });
  expect(await open({ link: "https://example.com" })).toEqual({
    error: "редактора нет: открыть адрес https://example.com некому",
  });
  expect(await open({ link: "mapward://core" })).toEqual({
    value: { kind: "object", address: "mapward://core" },
  });
});

test("папка — в проводнике редактора: текстом её не открыть", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = (await mkdtemp(join(tmpdir(), "mapward-nav-"))).replaceAll("\\", "/");
  try {
    const { open, editor } = plugin(true);
    expect(await open({ link: folder })).toEqual({ value: { kind: "folder", path: folder } });
    expect(editor).toEqual([{ method: "reveal", args: [folder] }]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
