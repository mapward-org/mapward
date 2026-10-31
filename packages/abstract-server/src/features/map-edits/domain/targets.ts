import type { MapObject } from "@mapward/core";
import {
  ACTIONS,
  CONFIG,
  findObject,
  INDEX,
  mapAddress,
  METRICS,
  parseAddress,
  WORKFLOW,
} from "@mapward/core";
import { join } from "../../../lib/path.ts";

/**
 * Что лежит по адресу своих полей — и каким файлом. Адрес говорит вид сам: `…/_metrics/<ключ>`
 * — метрика, `…/_actions/<ключ>` — экшон, `…/_directives.workflow/<имя>` — этап; остальное —
 * объект, а папка без `_index.json` с `config.json` — слой общей метрики или экшона. Полка без
 * `config.json` — место, где `set` индекса заводит объект.
 */
export type Target =
  | { kind: "object"; address: string; object: MapObject; file: string }
  | { kind: "directory"; address: string; object: MapObject; file: string }
  | { kind: "metric" | "action"; address: string; owner: MapObject; folder: string; file: string }
  | { kind: "stage"; address: string; owner: MapObject; file: string }
  | { kind: "layer"; address: string; folder: string; file: string };

/** Член объекта по адресу: метрика, экшон или этап. */
const MEMBERS = { [METRICS]: "metric", [ACTIONS]: "action", [WORKFLOW]: "stage" } as const;

/**
 * Цель по адресу. `layerAt` — папка новой общей метрики, когда адреса в модели ещё нет и о слое
 * сказано явно (`kind: "layer"`); её родитель обязан быть.
 */
export function locate(
  root: MapObject,
  address: string,
  options: { layer?: boolean; layerExists: (folder: string) => boolean },
): Target | { error: string } {
  const parsed = parseAddress(address);
  if (!parsed || parsed.scope !== "map" || parsed.field) {
    return { error: `${address} — не адрес карты: нужен mapward://… без «#»` };
  }
  const { path } = parsed;
  const folder = path.at(-2);
  const member = folder === undefined ? undefined : MEMBERS[folder as keyof typeof MEMBERS];
  if (member !== undefined) {
    const ownerAddress = mapAddress(path.slice(0, -2));
    const owner = findObject(root, ownerAddress);
    if (!owner) return { error: `Нет объекта ${ownerAddress}` };
    const key = (path.at(-1) ?? "").replace(/\.md$/, "");
    if (!key || key.startsWith(".")) return { error: `Пустой ключ в ${address}` };
    if (member === "stage") {
      return { kind: "stage", address, owner, file: join(owner.path, WORKFLOW, `${key}.md`) };
    }
    const dir = join(owner.path, member === "metric" ? METRICS : ACTIONS, key);
    return { kind: member, address, owner, folder: dir, file: join(dir, CONFIG) };
  }

  const object = findObject(root, address);
  if (object && !object.isGroup) {
    return { kind: "object", address, object, file: join(object.path, INDEX) };
  }
  if (object) {
    const file = join(object.path, CONFIG);
    if (options.layer || options.layerExists(file)) {
      return { kind: "layer", address, folder: object.path, file };
    }
    return { kind: "directory", address, object, file: join(object.path, INDEX) };
  }
  if (options.layer) {
    // Папки неявные: слой ложится по адресу, папки на пути создаст запись.
    if (path.length === 0 || path.some((step) => step.startsWith("_") || step.startsWith("."))) {
      return { error: `${address} — не место для слоя: служебная папка на пути` };
    }
    const dir = join(root.path, ...path);
    return { kind: "layer", address, folder: dir, file: join(dir, CONFIG) };
  }
  return {
    error: `Нет объекта ${address}: объект заводит create, слой общей метрики — set с kind: "layer"`,
  };
}
