import { Check } from "typebox/value";
import { StepWatch } from "@mapward/core";
import type { MetricConfig, StepWatch as StepWatchConfig } from "@mapward/core";
import { join, slash } from "../../../lib/path.ts";
import { matchesGlob } from "./glob.ts";

/**
 * Вотчер шага — решение 0043: за чем следит поле `watch` у коллектора или трансформа.
 *
 * Пути в `watch` считаются от той же папки, от которой шаг читает свои: у `read-dir` это его
 * `basePath`, у остальных — корень карты, откуда запускается скрипт. Абсолютный путь остаётся
 * как есть: так следят за кодом проекта, который лежит вне карты.
 */

export type Stage = "collect" | "transform";

/** Одна папка под вотчером порта и глоб внутри неё — так порт и принимает. */
export type WatchRoot = { root: string; pattern: string };

export type WatchTarget = {
  stage: Stage;
  /** Номер шага в своей стадии: по нему стор знает, что перезапускать. */
  index: number;
  roots: WatchRoot[];
  /** Полные глобы: изменение сверяется с ними, а не с тем, что отобрал порт. */
  include: string[];
  exclude: string[];
  debounce: number | undefined;
  /** Отпечаток: совпал — вотчер тот же, и переставлять его незачем. */
  key: string;
};

export type WatchPlan = { targets: WatchTarget[]; problems: string[] };

const glob = /[*?[{]/;

const absolute = (path: string): boolean => /^([A-Za-z]:)?\//.test(slash(path));

const full = (base: string, path: string): string =>
  absolute(path) ? slash(path) : join(base, path);

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map(String) : undefined;

/**
 * Папка, за которой следит порт, — всё до первого сегмента с глобом. Порт следит за деревом, и
 * чем ближе корень к нужному, тем меньше чужих событий он разбудит.
 */
export function rootOf(pattern: string): WatchRoot {
  const segments = slash(pattern).split("/");
  const cut = segments.findIndex((segment) => glob.test(segment));
  if (cut === -1) {
    return { root: segments.slice(0, -1).join("/"), pattern: segments.at(-1) ?? "" };
  }
  return { root: segments.slice(0, cut).join("/"), pattern: segments.slice(cut).join("/") };
}

/** Регистр не сверяется: на Windows редактор и конфиг пишут диск по-разному. */
const matches = (path: string, globs: string[]): boolean =>
  globs.some((pattern) => matchesGlob(path.toLowerCase(), pattern.toLowerCase()));

/** Задело ли изменение по этому пути вотчер шага. */
export function touches(target: WatchTarget, path: string): boolean {
  const changed = slash(path);
  return matches(changed, target.include) && !matches(changed, target.exclude);
}

function targetOf(
  stage: Stage,
  index: number,
  spec: Record<string, unknown>,
  cwd: string,
): WatchTarget | string | undefined {
  // Вьюха следит за картой сама, без поля (решение 0044): её значение — это `_index.json`
  // объектов и её `map-state.json`, и протухает оно от любой правки карты.
  const view = spec.kind === "objects-map";
  const raw = spec.watch ?? (view ? true : undefined);
  if (raw === undefined || raw === false) return undefined;

  const where = `${stage === "collect" ? "коллектор" : "трансформ"} ${String(spec.name ?? index)}`;
  if (!Check(StepWatch, raw)) {
    return `watch у шага «${where}»: ждали true или { include?, exclude?, debounce? }`;
  }

  const own: Exclude<StepWatchConfig, boolean> = typeof raw === "boolean" ? {} : raw;
  // `read-dir` свои пути знает сам: без `include` следим за тем, что он читает.
  const readDir = spec.kind === "read-dir";
  const base = readDir && typeof spec.basePath === "string" ? full(cwd, spec.basePath) : cwd;
  const include =
    own.include ??
    (readDir
      ? (strings(spec.include) ?? ["**"])
      : view
        ? ["**/_index.json", "**/map-state.json"]
        : undefined);
  const exclude = own.exclude ?? (readDir && !own.include ? (strings(spec.exclude) ?? []) : []);

  if (!include || include.length === 0) {
    return `watch у шага «${where}»: не сказано, за чем следить, — нужен include`;
  }

  const fullInclude = include.map((pattern) => full(base, pattern));
  const fullExclude = exclude.map((pattern) => full(base, pattern));
  const roots = fullInclude.map(rootOf);
  const debounce = typeof own.debounce === "number" ? own.debounce : undefined;

  return {
    stage,
    index,
    roots,
    include: fullInclude,
    exclude: fullExclude,
    debounce,
    key: JSON.stringify([stage, index, fullInclude, fullExclude, debounce ?? null]),
  };
}

/** Вотчеры шагов метрики по её конфигу — уже после подстановок, как он пришёл из карты. */
export function watchPlan(config: MetricConfig, cwd: string): WatchPlan {
  const targets: WatchTarget[] = [];
  const problems: string[] = [];

  const stages: [Stage, Record<string, unknown>[]][] = [
    ["collect", config.collectors ?? []],
    ["transform", config.transforms ?? []],
  ];
  for (const [stage, specs] of stages) {
    for (const [index, spec] of specs.entries()) {
      const target = targetOf(stage, index, spec, cwd);
      if (typeof target === "string") problems.push(target);
      else if (target) targets.push(target);
    }
  }

  return { targets, problems };
}
