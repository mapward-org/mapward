import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Безголовый браузер — Playwright, которого плагин ставит себе сам при первом вызове: в карту
 * `node_modules` не тянется, а в зависимости платформы браузер на сотню мегабайт не нужен тем, кто
 * скриншотов не делает. `playwright-core` ложится в кэш пользователя (`~/.mapward/screenshot`,
 * или `MAPWARD_SCREENSHOT_CACHE`), Chromium — туда, куда его кладёт сам Playwright (общий кэш
 * `ms-playwright`): второй проект с Playwright скачивать его заново не будет.
 */

/** Версия закреплена: браузер Playwright подходит только своей версии. */
export const PLAYWRIGHT_VERSION = "1.64.1";

/** Что плагину нужно от страницы Playwright — ровно это, чтобы подставной браузер в тесте был мал. */
export type PageLike = {
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): unknown;
  on(event: "pageerror", listener: (error: Error) => void): unknown;
  addInitScript(script: { content: string }): Promise<unknown>;
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  waitForFunction(
    body: string,
    arg?: unknown,
    options?: { timeout?: number; polling?: number },
  ): Promise<unknown>;
  /** Выражение в странице — его значение. */
  evaluate(expression: string): Promise<unknown>;
  screenshot(options: { fullPage?: boolean; type?: "png" }): Promise<Uint8Array>;
};

export type BrowserLike = {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PageLike>;
  close(): Promise<void>;
};

export type Launch = () => Promise<BrowserLike>;

export const cacheDir = (): string =>
  process.env.MAPWARD_SCREENSHOT_CACHE ?? join(homedir(), ".mapward", "screenshot");

/** Вывод команды целиком: ошибка установки без него ничего не объясняет. */
function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // `npm` на Windows — `npm.cmd`, и запустить его можно только через оболочку.
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) => reject(error));
    child.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`${command} ${args.join(" ")}: код ${String(code)}\n${output.trim()}`)),
    );
  });
}

const offline = (what: string, error: unknown) =>
  new Error(
    `${what} не вышло — скорее всего, нет сети: плагин screenshot ставит Playwright сам при первом ` +
      `вызове (npm install playwright-core@${PLAYWRIGHT_VERSION} в ${cacheDir()} и Chromium в кэш ` +
      `Playwright). Поставьте их руками или повторите с сетью.\n` +
      (error instanceof Error ? error.message : String(error)),
  );

type Playwright = {
  chromium: {
    executablePath(): string;
    launch(options: { headless: boolean }): Promise<BrowserLike>;
  };
};

/** `playwright-core` из кэша; нет — ставится. */
async function playwright(): Promise<{ module: Playwright; root: string }> {
  const dir = cacheDir();
  const root = join(dir, "node_modules", "playwright-core");
  if (!existsSync(join(root, "package.json"))) {
    await mkdir(dir, { recursive: true });
    try {
      await run(
        "npm",
        [
          "install",
          "--no-save",
          "--no-audit",
          "--no-fund",
          `playwright-core@${PLAYWRIGHT_VERSION}`,
        ],
        dir,
      );
    } catch (error) {
      throw offline("поставить playwright-core", error);
    }
  }
  const module = (await import(pathToFileURL(join(root, "index.mjs")).href)) as Playwright;
  return { module, root };
}

/** Chromium Playwright; нет — скачивается его же командой. */
export const launchChromium: Launch = async () => {
  const { module, root } = await playwright();
  if (!existsSync(module.chromium.executablePath())) {
    try {
      await run(process.execPath, [join(root, "cli.js"), "install", "chromium"], cacheDir());
    } catch (error) {
      throw offline("скачать Chromium", error);
    }
  }
  return module.chromium.launch({ headless: true });
};
