import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { BrowserLike, PageLike } from "./browser.ts";
import { cacheDir, launchChromium } from "./browser.ts";
import { capture, metricTarget, screenshotPath } from "./capture.ts";

/**
 * Скриншот метрики: страница плагина — сборка вебвью и прокладка моста — проверяется подставным
 * браузером, который ходит по ней обычным `fetch`. Настоящий браузер — последним тестом, и только
 * если Playwright уже стоит: ставить его тесту нечего.
 */

const MAP = { name: "m", mapPath: "/repo/map", basePath: "/repo" };

let assets = "";
let bridge: Server;
let bridgeUrl = "";
/** Что пришло на мост платформы: путь с сессией и тело. */
const bridged: string[] = [];

beforeEach(async () => {
  assets = await mkdtemp(join(tmpdir(), "mapward-screenshot-"));
  await writeFile(
    join(assets, "webview.mjs"),
    'document.getElementById("root").textContent = "клиент";',
  );
  await writeFile(join(assets, "webview.css"), "body{}");
  bridged.length = 0;
  bridge = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      bridged.push(`${request.method ?? ""} ${request.url ?? ""} ${body}`);
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  const address = bridge.address();
  bridgeUrl = `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : 0)}/bridge`;
});

afterEach(async () => {
  bridge.closeAllConnections();
  await new Promise((resolve) => bridge.close(resolve));
  await rm(assets, { recursive: true, force: true });
});

test("адрес метрики — объект и ключ; не метрика — внятная ошибка", () => {
  expect(metricTarget(MAP, "mapward://packages/core/_metrics/files")).toEqual({
    ...MAP,
    address: "mapward://packages/core",
    metric: "files",
  });
  expect(metricTarget(MAP, "mapward://_metrics/demo").address).toBe("mapward://");
  expect(() => metricTarget(MAP, "mapward://packages/core")).toThrow(/не адрес метрики/);
});

test("подставной браузер видит страницу вебвью, мост уходит на платформу, консоль и ошибки — в ответ", async () => {
  const seen: Record<string, string> = {};
  const browser: BrowserLike = {
    newPage: async (options) => {
      const listeners: Record<string, (value: never) => void> = {};
      const page: PageLike = {
        on: ((event: string, listener: (value: never) => void) => {
          listeners[event] = listener;
        }) as PageLike["on"],
        addInitScript: async () => {},
        goto: async (url) => {
          seen.html = await (await fetch(url)).text();
          seen.script = await (await fetch(new URL("/webview.mjs", url))).text();
          seen.missing = String((await fetch(new URL("/secret.txt", url))).status);
          await fetch(new URL("/bridge?session=s1", url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"hello":1}',
          });
          seen.viewport = `${String(options.viewport.width)}x${String(options.viewport.height)}`;
          (listeners.console as (message: { type(): string; text(): string }) => void)({
            type: () => "log",
            text: () => "нарисовал",
          });
          (listeners.console as (message: { type(): string; text(): string }) => void)({
            type: () => "error",
            text: () => "не нашёл плагин",
          });
          (listeners.pageerror as (error: Error) => void)(new Error("упал компонент"));
        },
        waitForFunction: async () => {},
        evaluate: async () => [],
        screenshot: async () => new Uint8Array([137, 80, 78, 71]),
      };
      return page;
    },
    close: async () => {},
  };

  // Снимок ложится в карту — здесь карта во временной папке.
  const map = { ...MAP, mapPath: assets };
  const result = await capture(
    { metric: "mapward://core/_metrics/files", width: 640 },
    { map, webview: { assets, bridge: bridgeUrl }, launch: async () => browser },
  );

  expect(result.path).toBe(
    screenshotPath(map, { ...map, address: "mapward://core", metric: "files" }),
  );
  expect([...(await readFile(result.path))]).toEqual([137, 80, 78, 71]);
  // Строкой — только по просьбе: агенту нужен файл, а не мегабайт base64 в ответе.
  expect(result.png).toBeUndefined();
  expect(result.console).toEqual(["log: нарисовал"]);
  expect(result.errors[0]).toBe("error: не нашёл плагин");
  expect(result.errors[1]).toContain("упал компонент");
  expect(seen.viewport).toBe("640x600");
  expect(seen.html).toContain('"address":"mapward://core"');
  expect(seen.html).toContain('"metric":"files"');
  expect(seen.html).toContain("acquireVsCodeApi");
  expect(seen.script).toContain("клиент");
  expect(seen.missing).toBe("404");
  expect(bridged).toEqual(['POST /bridge?session=s1 {"hello":1}']);
});

test("заглушки загрузки не ушли — снимок как есть, и в консоли сказано, чего не дождались", async () => {
  const page: PageLike = {
    on: (() => {}) as PageLike["on"],
    addInitScript: async () => {},
    goto: async () => {},
    waitForFunction: async () => {
      throw new Error("timeout");
    },
    evaluate: async () => ["собирается…", ""],
    screenshot: async () => new Uint8Array([137, 80, 78, 71]),
  };
  const browser: BrowserLike = { newPage: async () => page, close: async () => {} };
  const result = await capture(
    { metric: "mapward://_metrics/x", base64: true },
    {
      map: { ...MAP, mapPath: assets },
      webview: { assets, bridge: bridgeUrl },
      launch: async () => browser,
      timeout: 1000,
    },
  );
  expect(result.console.join("\n")).toContain("не догрузилось: собирается…");
  expect(result.png).toBe(Buffer.from([137, 80, 78, 71]).toString("base64"));
});

test("перекрытия снимка уезжают на страницу; без них страница — как у человека", async () => {
  const pages: string[] = [];
  const browser: BrowserLike = {
    newPage: async () => ({
      on: (() => {}) as PageLike["on"],
      addInitScript: async () => {},
      goto: async (url) => {
        pages.push(await (await fetch(url)).text());
      },
      waitForFunction: async () => {},
      evaluate: async () => [],
      screenshot: async () => new Uint8Array([137, 80, 78, 71]),
    }),
    close: async () => {},
  };
  const env = {
    map: { ...MAP, mapPath: assets },
    webview: { assets, bridge: bridgeUrl },
    launch: async () => browser,
  };
  await capture(
    {
      metric: "mapward://core/_metrics/files",
      expand: "all",
      viewState: { "views:tree:x": ["src"] },
      params: { maxHeight: 900 },
    },
    env,
  );
  await capture({ metric: "mapward://core/_metrics/files" }, env);

  expect(pages[0]).toContain(
    '"snapshot":{"viewState":{"views:tree:x":["src"]},"expand":"all","params":{"maxHeight":900}}',
  );
  expect(pages[1]).not.toContain("snapshot");
});

test("без клиента карты рисовать нечем — так и сказано", async () => {
  await expect(
    capture(
      { metric: "mapward://_metrics/x" },
      { map: MAP, webview: undefined, launch: () => Promise.reject(new Error("не звать")) },
    ),
  ).rejects.toThrow(/рисовать нечем/);
});

const playwright = existsSync(join(cacheDir(), "node_modules", "playwright-core", "package.json"));

test.skipIf(!playwright)(
  "настоящий браузер: страница рисуется, консоль и ошибки ловятся",
  async () => {
    await writeFile(
      join(assets, "webview.mjs"),
      [
        'document.getElementById("root").textContent = "клиент";',
        'console.log("нарисовал");',
        'setTimeout(() => { throw new Error("упал компонент"); }, 0);',
      ].join("\n"),
    );
    const result = await capture(
      { metric: "mapward://_metrics/x", width: 320, height: 200 },
      {
        map: { ...MAP, mapPath: assets },
        webview: { assets, bridge: bridgeUrl },
        launch: launchChromium,
        timeout: 10_000,
      },
    );
    expect((await readFile(result.path)).subarray(1, 4).toString()).toBe("PNG");
    expect(result.console).toContain("log: нарисовал");
    expect(result.errors.join("\n")).toContain("упал компонент");
  },
  120_000,
);
