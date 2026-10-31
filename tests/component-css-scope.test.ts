import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { scopeCss } from "../packages/abstract-server/src/features/components/domain/scope-css.ts";
import { cacheDir, launchChromium } from "../packages/plugins/registry/screenshot/browser.ts";

/**
 * Css компонента не перебивает карту — решение 0048. Каскад с `@scope` считает только браузер,
 * поэтому тест идёт в Chromium плагина скриншотов. Нет его в кэше — тест пропускается, а не
 * ставит браузер по сети.
 *
 * Как сломалось 24.09: у рамки сетки `p-2 pl-6`, компонент в клетке приносит свой `p-2` ниже по
 * странице, и левый отступ рамки пропадает.
 */

// tailwind стоит у сервера, который собирает компоненты, а не в корне.
const require = createRequire(
  join(import.meta.dirname, "../packages/abstract-server/package.json"),
);
const tailwindRoot = join(require.resolve("tailwindcss/package.json"), "..");
const { compile } = require("tailwindcss") as typeof import("tailwindcss");
const sheets: Record<string, string> = {
  "tailwindcss/theme.css": readFileSync(join(tailwindRoot, "theme.css"), "utf8"),
  "tailwindcss/utilities.css": readFileSync(join(tailwindRoot, "utilities.css"), "utf8"),
};

async function tailwind(classes: string[]): Promise<string> {
  const compiler = await compile(
    [
      "@layer theme, base, components, utilities;",
      '@import "tailwindcss/theme.css" layer(theme);',
      '@import "tailwindcss/utilities.css" layer(utilities);',
    ].join("\n"),
    {
      loadStylesheet: async (id, base) => ({ path: id, base, content: sheets[id] ?? "" }),
    },
  );
  return compiler.build(classes);
}

const hasBrowser = existsSync(join(cacheDir(), "node_modules", "playwright-core", "package.json"));

let close: (() => Promise<void>) | undefined;
/** Страница Playwright — то, что нужно тесту; у настоящей `setContent` есть. */
type Page = {
  setContent(html: string): Promise<unknown>;
  evaluate(code: string): Promise<unknown>;
};
let page: Page | undefined;

beforeAll(async () => {
  if (!hasBrowser) return;
  const browser = await launchChromium();
  close = () => browser.close();
  page = (await browser.newPage({ viewport: { width: 800, height: 600 } })) as unknown as Page;
});

afterAll(async () => {
  await close?.();
});

test.skipIf(!hasBrowser)("css компонента не трогает рамку сетки и карточку карты", async () => {
  const map = await tailwind(["p-2", "pl-6"]);
  // Компонент, как у Пауля: свой `p-2` без `pl-6`, и класс, которого у карты нет, — для меню.
  const component = scopeCss(await tailwind(["p-2", "pr-7"]), "c1");
  await page!.setContent(`<!doctype html>
    <style>${map}</style>
    <div id="frame" class="p-2 pl-6">
      <style>${component}</style>
      <div data-mw-component="c1" style="display: contents">
        <div id="plain" class="p-2"></div>
        <div data-mw-map="" style="display: contents">
          <div id="card" class="p-2 pl-6"></div>
          <div data-mw-component="c1" style="display: contents">
            <div id="actions" class="pr-7"></div>
          </div>
        </div>
      </div>
    </div>
    <div data-mw-component="c1"><div id="menu" class="pr-7"></div></div>
    <div id="outside" class="pr-7"></div>`);
  const left = (id: string) =>
    page!.evaluate(`getComputedStyle(document.getElementById("${id}")).paddingLeft`);
  const right = (id: string) =>
    page!.evaluate(`getComputedStyle(document.getElementById("${id}")).paddingRight`);

  // Рамка сетки и карточка карты — как без компонента.
  expect(await left("frame")).toBe("24px");
  expect(await left("card")).toBe("24px");
  // Внутри компонента — его классы.
  expect(await left("plain")).toBe("8px");
  // Его классы — в клетке, в кнопках на карточке и в слое окон, но не снаружи.
  expect(await right("actions")).toBe("28px");
  expect(await right("menu")).toBe("28px");
  expect(await right("outside")).toBe("0px");
});
