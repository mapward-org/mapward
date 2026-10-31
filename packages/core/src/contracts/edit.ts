import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeMethod } from "./bridge.ts";

/**
 * Правка карты — базовый набор платформы в словах самого mapward: свои поля объекта, метрики,
 * экшона, слоя и этапа, структура карты и сырые файлы. Целостность адресов — общий инвариант
 * карты, как одинаковое чтение: перенос, который забыл бы переписать адрес в чьём-то `extends`
 * или `props`, ломает карту всем. Поэтому правку делает платформа, а интерфейс, агент (MCP
 * `edit_map`) и плагины (`ctx.editMap`) зовут одно и то же — и агент пишет карту целиком
 * методами, не ходя в файловую систему.
 *
 * Пачка операций применяется по очереди, каждая — по модели, где уже есть сделанное предыдущими,
 * и отменяется целиком по номеру. Стек отмены держит тот, кто звал.
 */

const Address = T.String({ description: "адрес объекта: mapward://…" });

/**
 * Свои поля по адресу: объект (`_index.json` как написан), метрика (`…/_metrics/<ключ>`), экшон
 * (`…/_actions/<ключ>`), слой общей метрики или экшона (папка с `config.json` без `_index.json`)
 * и этап воркфлоу (`…/_directives.workflow/<файл без .md>`).
 */
const Own = T.String({
  description:
    "адрес объекта, метрики (…/_metrics/<ключ>), экшона (…/_actions/<ключ>), слоя или этапа (…/_directives.workflow/<имя>)",
});

/** Отпечаток содержимого файла из `get`/`readFile`: запись с ним не затрёт чужую правку. */
const Version = T.String({
  description: "version из get/readFile: файл с тех пор менялся — отказ",
});

const Path = T.String({ description: "путь файла: от папки карты или абсолютный внутри неё" });

export const MapEditOp = T.Union([
  T.Object(
    { op: T.Literal("get"), address: Own },
    {
      description:
        "свои поля по адресу — как написаны, без наследования и подстановок: { content, version }",
    },
  ),
  T.Object(
    {
      op: T.Literal("set"),
      address: Own,
      /**
       * Полная замена, не слияние. Метрика берёт и короткую форму по шаблону плагина:
       * `{ label?, plugin, template, params }`; этап — `{ name, order, marksDone?, text }`.
       */
      content: T.Unknown(),
      version: T.Optional(Version),
      /** Новый слой общей метрики или экшона по адресу, которого ещё нет. */
      kind: T.Optional(T.Literal("layer")),
    },
    {
      description:
        "заменить свои поля целиком, с проверкой схемой; несуществующую метрику, экшон, этап создаёт; индекс по адресу полки делает её объектом",
    },
  ),
  T.Object(
    {
      op: T.Literal("delete"),
      address: Own,
      /**
       * Объект → полка: убрать только `_index.json` и служебное объекта (`_metrics`, `_actions`,
       * `_directives*`), дети остаются. Отказ, если на объект ссылаются.
       */
      keepChildren: T.Optional(T.Boolean()),
      /** Полка с объектами внутри удаляется только так: без него отказ их называет. */
      recursive: T.Optional(T.Boolean()),
    },
    {
      description:
        "удалить объект с папкой, полку, метрику, экшон, слой или этап — в корзину пачки, отмена вернёт; keepChildren: true — объект становится полкой; полку с объектами — только recursive: true",
    },
  ),
  T.Object(
    {
      op: T.Literal("create"),
      /** Родитель: объект, полка или корень карты; недостающие папки на пути создаются. */
      parent: Address,
      /** Имя папки; не названо — из `content.name`. Занятое у родителя получает номер: `сервис-2`. */
      folder: T.Optional(T.String()),
      /** `_index.json` нового объекта целиком — проверяется схемой. */
      content: T.Record(T.String(), T.Unknown()),
    },
    { description: "новый объект — папка с _index.json у родителя" },
  ),
  T.Object(
    { op: T.Literal("move"), object: Address, parent: Address },
    { description: "перенести объект или полку к новому родителю под тем же именем папки" },
  ),
  T.Object(
    { op: T.Literal("setFolder"), object: Address, folder: T.String() },
    { description: "новое имя папки объекта или полки — последний шаг адреса" },
  ),
  T.Object(
    {
      op: T.Literal("copy"),
      /** Каждый — к своему родителю под свободным именем папки. */
      objects: T.Array(T.Object({ object: Address, parent: Address })),
      /** Что из едущего с копируемыми оставить у оригинала. */
      skip: T.Optional(T.Array(T.String())),
    },
    {
      description:
        "копии объектов с потомками; адреса копируемых в текстах копий указывают на копии",
    },
  ),
  T.Object(
    { op: T.Literal("readFile"), path: Path },
    { description: "сырой файл карты: { text, version }; нет файла — text: null" },
  ),
  T.Object(
    { op: T.Literal("writeFile"), path: Path, text: T.String(), version: T.Optional(Version) },
    { description: "записать сырой файл карты — без схем и сборки; папки на пути создаются" },
  ),
  T.Object(
    { op: T.Literal("removeFile"), path: Path },
    { description: "убрать сырой файл карты — в корзину пачки" },
  ),
  T.Object(
    {
      op: T.Literal("check"),
      /** Адрес метрики, объекта (его раскладки и метрики), экшона — или папка плагина. */
      address: T.String(),
      /** Сколько ждать пробный запрос для агента, мс; по умолчанию 30000. */
      timeout: T.Optional(T.Number()),
    },
    {
      description:
        "проверить: метрику (сборка компонента, пробный запрос для агента), объект (раскладки групп и метрики), экшон (форма, метод), папку плагина (как check_plugin)",
    },
  ),
  T.Object(
    { op: T.Literal("installDeps"), plugin: T.String() },
    { description: "поставить dependencies из package.json плагина в его папку (npm install)" },
  ),
]);
export type MapEditOp = Static<typeof MapEditOp>;

const Move = T.Object({ from: T.String(), to: T.String() });

export const MapEditResult = T.Union([
  T.Object({
    ok: T.Literal(true),
    /** Номер пачки: по нему её отменяют и повторяют. */
    id: T.String(),
    /** Какие файлы пачка тронула. */
    touched: T.Array(T.String()),
    /** Новые объекты — по порядку операций. */
    created: T.Array(T.String()),
    /**
     * Переезды: старый адрес — новый, у перенесённых и их потомков. По ним свои файлы с
     * адресами переписывает тот, кто их ведёт: карта переписана платформой.
     */
    moves: T.Array(Move),
    /** Копии: адрес оригинала — адрес копии, с потомками. */
    copies: T.Array(Move),
    /** Ответ каждой операции по порядку: `get` — `{ content, version }`, `check` — отчёт, … */
    results: T.Array(T.Unknown()),
  }),
  T.Object({
    ok: T.Literal(false),
    /** Почему отказ: имя занято, перенос внутрь себя, файлы поменяли мимо отмены. */
    error: T.String(),
    /** Что не прошло схему — строкой на поле: путь до него и что ожидалось. */
    errors: T.Optional(T.Array(T.String())),
    /** Файл изменился с переданной `version`: какой он сейчас — как его отдал бы `get`. */
    current: T.Optional(T.Unknown()),
  }),
]);
export type MapEditResult = Static<typeof MapEditResult>;

/** Шаг проверки: прошёл, упал или пропущен; строки — что именно, с файлом и позицией. */
export type CheckStep = { title: string; status: "ok" | "fail" | "skip"; lines: string[] };

/** Отчёт `check`: тот же вид, что у проверки плагина. */
export type CheckReport = { target: string; ok: boolean; steps: CheckStep[] };

/**
 * Отпечаток текста файла — `version` у `get` и `readFile`. Не криптография, а сторож от записи
 * поверх чужой правки: 53 бита хватает, чтобы случайное совпадение не случалось.
 */
export function contentVersion(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2_654_435_761);
    h2 = Math.imul(h2 ^ code, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  return (4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0)).toString(36);
}

const EditTarget = { mapPath: T.String(), basePath: T.String(), name: T.String() };

export const editBridge = {
  editMap: createBridgeMethod(T.Object({ ...EditTarget, ops: T.Array(MapEditOp) }), MapEditResult),
  undoEdit: createBridgeMethod(T.Object({ ...EditTarget, id: T.String() }), MapEditResult),
  /** Повтор отменённой пачки — отмена отмены, с той же проверкой файлов. */
  redoEdit: createBridgeMethod(T.Object({ ...EditTarget, id: T.String() }), MapEditResult),
};
