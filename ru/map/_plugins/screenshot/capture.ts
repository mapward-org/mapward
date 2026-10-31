import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginMap, PluginWebview } from "@mapward/plugin";
import type { Launch } from "./browser.ts";
import { servePage, type PageTarget } from "./page.ts";

export type CaptureArgs = {
  metric: string;
  width?: number;
  height?: number;
  base64?: boolean;
  /** Значения `useViewState` по ключу — только на этот снимок. */
  viewState?: Record<string, unknown>;
  /** `"all"` — всё раскрыто, ничего не свёрнуто. */
  expand?: "all";
  /** `params` метрики поверх её конфига — только на этот снимок. */
  params?: Record<string, unknown>;
};

/** Перекрытия снимка — только названные: без них страница — как у человека. */
const snapshotOf = (args: CaptureArgs): PageTarget["snapshot"] => {
  const snapshot = {
    ...(args.viewState === undefined ? {} : { viewState: args.viewState }),
    ...(args.expand === undefined ? {} : { expand: args.expand }),
    ...(args.params === undefined ? {} : { params: args.params }),
  };
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
};
/** `path` — PNG на диске карты; `png` — он же строкой base64, только если просили. */
export type Captured = { path: string; png?: string; console: string[]; errors: string[] };

const METRIC = /^(mapward:\/\/.*?)\/?_metrics\/([^/#]+)$/;

/** Адрес метрики — объект и ключ: страница открывает таб этой одной метрики (решение 0026). */
export function metricTarget(map: PluginMap, metric: string): PageTarget {
  const found = METRIC.exec(metric.trim());
  if (!found?.[1] || !found[2]) {
    throw new Error(`${metric} — не адрес метрики: ждали mapward://…/_metrics/<ключ>`);
  }
  return { ...map, address: found[1], metric: found[2] };
}

/**
 * Готово, когда заглушек загрузки не осталось и разметка стихла. Клиент дорисовывает метрику
 * частями — объект, сборку компонента, ответы плагинов, — и общего «всё» у него нет. Заглушки
 * («Читаем карту…», «собирается…», «загружается…») помечены `data-loading`: пока они есть, рано,
 * сколько бы страница ни молчала. Тишина — `QUIET_MS` без изменений дерева после этого.
 */
const QUIET_MS = 700;

const WATCH_MUTATIONS = `
window.__mapwardChanged = Date.now();
new MutationObserver(() => (window.__mapwardChanged = Date.now())).observe(document, {
  subtree: true, childList: true, characterData: true, attributes: true,
});`;

const SETTLED = `(quiet) => {
  const root = document.getElementById("root");
  return (
    !!root &&
    root.childElementCount > 0 &&
    !document.querySelector("[data-loading]") &&
    Date.now() - window.__mapwardChanged > quiet
  );
}`;

/** Что так и не догрузилось — тексты заглушек, чтобы агент видел, чего не дождались. */
const LOADING = `[...document.querySelectorAll("[data-loading]")].map((node) => node.textContent.trim())`;

/**
 * Куда ложится снимок: `.mapward/screenshots/` карты — локальное, вне git. Файл на метрику:
 * новый снимок заменяет прошлый, копиться нечему.
 */
export function screenshotPath(map: PluginMap, target: PageTarget): string {
  const slug = `${target.address.replace(/^mapward:\/\//, "") || "root"}__${target.metric}`
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .slice(0, 150);
  return join(map.mapPath, ".mapward", "screenshots", `${slug}.png`);
}

/**
 * Скриншот метрики так, как её видит человек: та же сборка вебвью и тот же мост до платформы,
 * только в безголовом браузере. Консоль и ошибки страницы приходят вместе с картинкой — по ним
 * агент понимает, почему метрика нарисовалась не так.
 */
export async function capture(
  args: CaptureArgs,
  env: { map: PluginMap; webview: PluginWebview | undefined; launch: Launch; timeout?: number },
): Promise<Captured> {
  if (!env.webview) {
    throw new Error(
      "рисовать нечем: клиент карты есть только у платформы в редакторе, а эта поднята без него " +
        "(mapward mcp без живого редактора). Откройте карту в VS Code — mapward mcp сам станет " +
        "его клиентом",
    );
  }
  const located = metricTarget(env.map, args.metric);
  const snapshot = snapshotOf(args);
  const target: PageTarget = snapshot ? { ...located, snapshot } : located;
  const width = args.width ?? 800;
  const height = args.height ?? 600;
  const timeout = env.timeout ?? 20_000;

  const page = await servePage({ ...env.webview, target });
  const browser = await env.launch().catch(async (error: unknown) => {
    await page.close();
    throw error;
  });
  const logs: string[] = [];
  const errors: string[] = [];
  try {
    const tab = await browser.newPage({ viewport: { width, height } });
    tab.on("console", (message) => {
      const line = `${message.type()}: ${message.text()}`;
      if (message.type() === "error") errors.push(line);
      else logs.push(line);
    });
    tab.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await tab.addInitScript({ content: WATCH_MUTATIONS });
    await tab.goto(page.url, { timeout });
    await tab
      .waitForFunction(`(${SETTLED})(${QUIET_MS})`, undefined, { timeout, polling: 100 })
      .catch(async () => {
        const waiting = ((await tab.evaluate(LOADING).catch(() => [])) as string[]).filter(Boolean);
        logs.push(
          `screenshot: страница не готова за ${String(timeout / 1000)} с — снимок как есть` +
            (waiting.length > 0 ? `; не догрузилось: ${waiting.join(", ")}` : ""),
        );
      });
    const png = await tab.screenshot({ fullPage: true, type: "png" });
    const path = screenshotPath(env.map, target);
    await mkdir(join(env.map.mapPath, ".mapward", "screenshots"), { recursive: true });
    // `.mapward` — локальное карты; звёздочка в нём самом, если её ещё нет.
    await writeFile(join(env.map.mapPath, ".mapward", ".gitignore"), "*\n", { flag: "wx" }).catch(
      () => {},
    );
    await writeFile(path, png);
    return {
      path,
      ...(args.base64 ? { png: Buffer.from(png).toString("base64") } : {}),
      console: logs,
      errors,
    };
  } finally {
    await browser.close().catch(() => {});
    await page.close();
  }
}
