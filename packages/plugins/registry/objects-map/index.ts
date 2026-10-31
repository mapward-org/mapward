import { watch, type FSWatcher } from "node:fs";
import { definePlugin } from "@mapward/plugin";
import type { MapEditResult, MapObject, PluginCtx } from "@mapward/plugin";
import { defer, Observable, type Unsubscribable } from "rxjs";
import { Type } from "typebox";
import { Journal, nodeDisk, type Disk } from "./model/journal.ts";
import { findObject } from "./model/map.ts";
import { EditResult, isMapOp, MapOp } from "./model/ops.ts";
import { editSources, NOTHING, planEdit } from "./model/plan.ts";
import type { MapDone } from "./model/plan.ts";
import type { ObjectsMap } from "./model/types.ts";
import {
  findView,
  joinParts,
  objectsMap,
  objectsMapConfig,
  parseViewState,
  viewHolder,
  viewParts,
  viewsOf,
} from "./model/view.ts";
import type { FoundView } from "./model/view.ts";
import { pinnedEnds } from "./canvas/layout.ts";

/**
 * Холст карты — решение 0044. Вьюха — метрика-компонент этого плагина: в её `params` сказано, что
 * показать, а рядом с `config.json` лежит `map-state.json` — позиции, ссылки, пометки. Плагин
 * считает вьюху по карте и этому файлу и правит карту операциями холста: человек на холсте и
 * агент через `call_plugin` зовут одно и то же.
 *
 * Вьюха (`model/view.ts`) и план операции (`model/plan.ts`) — свои: связи, ссылки, копии,
 * пометки и `map-state.json` — понятия холста, а не карты. Саму карту (создать объект,
 * перенести, удалить) правит платформа — `ctx.editMap`: целостность адресов у неё общая на всех.
 * Свой `map-state.json` холст переписывает вторым шагом по переездам из её ответа. Холст —
 * `view.tsx` и `canvas/`: его раскладкой (`canvas/layout.ts`) план и закрепляет концы новой
 * стрелки.
 */

const ROOT = "mapward://";
/** Сколько ждать, что снимок карты показал записанное платформой, прежде чем считать по тому, что есть. */
const SETTLE_MS = 3_000;

const slash = (value: string) => value.replaceAll("\\", "/");
const dirname = (value: string) => slash(value).replace(/\/[^/]*$/, "");
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const noop = () => {};
/** Вьюха — метрика, чей плагин для агента — этот: по папке плагина. */
const isViewOf = (ctx: PluginCtx) => viewsOf(ctx.pluginDir);

/** Что снимок карты должен показать после правки: эти адреса — объектами, этих — нет вовсе. */
type Expectation = { present: string[]; absent: string[] };

/** Ожидание по ответу правки карты: новые и переехавшие — есть, старые адреса переехавших — нет. */
const expectationOf = (done: MapDone): Expectation => ({
  present: [
    ...done.created,
    ...done.moves.map((move) => move.to),
    ...done.copies.map((copy) => copy.to),
  ],
  absent: done.moves.map((move) => move.from),
});

/**
 * Карта целиком — для правки, одна подписка на процесс. План операции холста считается по снимку
 * всей карты: связи к удаляемому, концы стрелок, что видно на вьюхе. Поэтому это `Infinity` от
 * корня, и держится он только на время пачки правок — вьюха его не держит, она читает только
 * свои ветки (`viewParts`).
 *
 * Платформа отвечает на правку, когда её модель уже видит записанное, но снимок этой подписки
 * может прийти чуть позже ответа. Поэтому записанное холст помнит ожиданием: следующая операция
 * пачки считается по снимку, где оно уже есть, — иначе созданный объект не нашёлся бы для стрелки
 * к нему в той же пачке.
 */
class Tree {
  private root: MapObject | undefined;
  private subscription: Unsubscribable | undefined;
  private holders = 0;
  private readonly listeners = new Set<() => void>();
  /** Адрес — должен ли он быть объектом; последнее ожидание по адресу перекрывает прежние. */
  private readonly expected = new Map<string, boolean>();

  constructor(private readonly ctx: PluginCtx) {}

  hold(listener?: () => void): () => void {
    if (listener) this.listeners.add(listener);
    this.holders += 1;
    this.subscription ??= this.ctx.tree(ROOT, Infinity).subscribe({
      next: (root) => {
        this.root = root;
        for (const notify of Array.from(this.listeners)) notify();
      },
      error: (error) => this.ctx.log(`карта не пришла: ${message(error)}`),
    });
    return () => {
      if (listener) this.listeners.delete(listener);
      this.holders -= 1;
      if (this.holders > 0) return;
      this.subscription?.unsubscribe();
      this.subscription = undefined;
      this.root = undefined;
    };
  }

  expect(expectation: Expectation): void {
    for (const address of expectation.absent) this.expected.set(address, false);
    for (const address of expectation.present) this.expected.set(address, true);
  }

  private settled(root: MapObject): boolean {
    return [...this.expected].every(([address, present]) => {
      const found = findObject(root, address);
      return present ? found !== undefined && !found.isGroup : found === undefined;
    });
  }

  /** Снимок, в котором уже есть записанное этой пачкой; не дождались — какой есть. */
  fresh(): Promise<MapObject> {
    return new Promise<MapObject>((resolve, reject) => {
      let done = false;
      let release = noop;
      const finish = (root: MapObject | undefined) => {
        if (done || !root) return;
        done = true;
        clearTimeout(timer);
        this.expected.clear();
        release();
        resolve(root);
      };
      const check = () => {
        if (this.root && this.settled(this.root)) finish(this.root);
      };
      const timer = setTimeout(() => {
        if (this.root) finish(this.root);
        else {
          done = true;
          release();
          reject(new Error("карта не пришла от платформы"));
        }
      }, SETTLE_MS);
      release = this.hold(check);
      check();
    });
  }
}

/** Пачки правок идут по одной: две вперемешку перепутали бы файлы и отмену. */
function queue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run, run);
    tail = next.catch(() => {});
    return next;
  };
}

/** Кто смотрит на состояние вьюх: запись плагина будит их сразу, не дожидаясь вотчера. */
type Watchers = Map<string, Set<() => void>>;

function poke(watchers: Watchers, touched: string[]): void {
  for (const file of touched) for (const wake of watchers.get(file) ?? []) wake();
}

/** Отказ правки карты — строкой; удача — сама собой. */
const outcome = (result: MapEditResult) =>
  result.ok ? ({ ok: true } as const) : ({ ok: false, error: result.error } as const);

const VIEW_ARGS = Type.Object({
  view: Type.String({ description: "адрес метрики-вьюхи: mapward://…/_metrics/<ключ>" }),
  config: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description:
        "конфиг вьюхи вместо params метрики: show, prototypes, exclude, expand, style, palette, placeObjects, placeRelations",
    }),
  ),
});

const strings = (description?: string) =>
  Type.Optional(Type.Array(Type.String(), description === undefined ? {} : { description }));

/** Настройка вьюхи — `params` метрики холста: по этой схеме платформа проверяет запись. */
const VIEW_CONFIG = Type.Object({
  show: strings("что показывать: адреса и маски (packages/*)"),
  prototypes: strings("и объекты этих прототипов — адресом или именем"),
  exclude: strings("что вырезать вместе с веткой"),
  expand: Type.Optional(
    Type.Object(
      { objects: strings(), prototypes: strings() },
      { description: "что рисуется группой с жильцами внутри" },
    ),
  ),
  style: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "вид узлов: all, prototypes, objects",
    }),
  ),
  palette: Type.Optional(
    Type.Object(
      { objects: strings(), relations: strings() },
      { description: "прототипы, которые ставит боковая панель" },
    ),
  ),
  placeObjects: Type.Optional(
    Type.String({ description: "куда уходит объект, брошенный на пустое место" }),
  ),
  placeRelations: Type.Optional(Type.String({ description: "куда кладутся новые связи" })),
});

/**
 * Операция в пачке — `MapOp`, только `view` у неё может не быть: его даёт `view` пачки. Схема та
 * же, что видит агент, — без этого послабления проверка аргументов отвергла бы пачку до `edit`.
 */
const OP_IN_BATCH = {
  anyOf: MapOp.anyOf.map((op) => ({
    ...op,
    required: op.required.filter((name) => name !== "view"),
  })),
};

const EDIT = Type.Object({
  view: Type.Optional(Type.String({ description: "адрес метрики-вьюхи" })),
  ops: Type.Array(Type.Unsafe<unknown>(OP_IN_BATCH), {
    description: "операции пачки, по порядку",
  }),
});

const BATCH = (description: string) => Type.Object({ id: Type.String({ description }) });

/**
 * Плагин целиком — фабрикой: у каждого процесса (и у каждого теста) свои пачки и своя подписка
 * на карту. Диск подменяется в тесте.
 */
export function objectsMapPlugin(disk: Disk = nodeDisk) {
  const journal = new Journal(disk);
  const serial = queue();
  const watchers: Watchers = new Map();
  let shared: Tree | undefined;
  const treeOf = (ctx: PluginCtx) => (shared ??= new Tree(ctx));
  const mapUndo = (ctx: PluginCtx) => ({
    undo: async (id: string) => outcome(await ctx.undoEdit(id)),
    redo: async (id: string) => outcome(await ctx.redoEdit(id)),
  });

  /**
   * Пачка операций холста: по очереди, каждая — по снимку, где уже есть сделанное предыдущими.
   * Операция — правка карты платформой (`ctx.editMap`), потом свой `map-state.json` по её ответу.
   * Между этими двумя записями — окно: упади процесс в нём, карта уже правлена, а состояние вьюхи
   * ещё нет — узел на холсте теряет позицию или ссылку, объект и связи целы. Это принято: держать
   * обе записи одной сделкой значило бы отдать платформе файлы холста.
   */
  async function edit(
    ctx: PluginCtx,
    view: string | undefined,
    raw: unknown[],
  ): Promise<EditResult> {
    const ops = raw.map((op) =>
      // Вьюха пачки — умолчание для операций, которые её не назвали.
      view !== undefined && typeof op === "object" && op !== null && !("view" in op)
        ? { ...op, view }
        : op,
    );
    const wrong = ops.findIndex((op) => !isMapOp(op));
    if (wrong !== -1) {
      return {
        ok: false,
        error: `Операция ${wrong + 1} не того вида: ${JSON.stringify(raw[wrong])}. Виды — в схеме ops.`,
      };
    }
    if (ops.length === 0)
      return { ok: false, error: "Пустая пачка: ops не назвал ни одной операции" };

    const tree = treeOf(ctx);
    const isView = isViewOf(ctx);
    const pack = journal.begin();
    const touched = new Set<string>();
    const release = tree.hold();
    /** Отказ откатывает всю пачку: свои записи, потом правки карты от последней к первой. */
    const rollback = async (error: string): Promise<EditResult> => {
      poke(watchers, await journal.unwrite(pack));
      for (const batch of pack.maps.toReversed()) {
        // oxlint-disable-next-line no-await-in-loop
        await ctx.undoEdit(batch);
      }
      return { ok: false, error };
    };

    try {
      for (const [index, op] of (ops as MapOp[]).entries()) {
        const where = ops.length > 1 ? `Операция ${index + 1} (${op.op}): ` : "";
        // oxlint-disable-next-line no-await-in-loop
        const root = await tree.fresh();
        const files = new Map<string, string>();
        // oxlint-disable-next-line no-await-in-loop
        await Promise.all(
          editSources(root, isView, op).map(async (file) => {
            const text = await disk.read(file);
            if (text !== undefined) files.set(file, text);
          }),
        );
        const plan = planEdit({ root, files, isView, pin: pinnedEnds }, op);
        // oxlint-disable-next-line no-await-in-loop
        if ("error" in plan) return await rollback(`${where}${plan.error}`);
        let done: MapDone = NOTHING;
        if (plan.ops.length > 0) {
          // oxlint-disable-next-line no-await-in-loop
          const result = await ctx.editMap(plan.ops);
          // oxlint-disable-next-line no-await-in-loop
          if (!result.ok) return await rollback(`${where}${result.error}`);
          pack.maps.push(result.id);
          for (const file of result.touched) touched.add(file);
          tree.expect(expectationOf(result));
          done = result;
        }
        try {
          for (const [file, text] of plan.finish(done)) {
            // oxlint-disable-next-line no-await-in-loop
            if (await journal.write(pack, file, text)) touched.add(file);
          }
        } catch (error) {
          // oxlint-disable-next-line no-await-in-loop
          return await rollback(`${where}${message(error)}`);
        }
        poke(watchers, [...touched]);
      }
    } finally {
      release();
    }
    journal.save(pack);
    return { ok: true, id: pack.id, touched: [...touched] };
  }

  async function flip(ctx: PluginCtx, id: string, from: "done" | "undone"): Promise<EditResult> {
    const result = await journal.toggle(id, from, mapUndo(ctx));
    if (!result.ok) return result;
    poke(watchers, result.touched);
    return { ok: true, id, touched: result.touched };
  }

  return definePlugin({
    description:
      "Холст карты: вьюха (что показать, как нарисовать, куда идут стрелки) и правка карты операциями холста с отменой",
    templates: {
      // Метрика-холст: агент видит ту же вьюху, что человек, — методом `view` с адресом метрики.
      view: {
        component: "view.tsx",
        description: "холст карты: объекты узлами, связи стрелками, правка мышью",
        params: VIEW_CONFIG,
        agent: { method: "view", metric: "view" },
      },
    },
    methods: {
      view: {
        kind: "query",
        description:
          "Вьюха потоком: узлы, стрелки, пометки, палитра — то же, что человек видит на холсте. " +
          "Пересчитывается при каждом изменении карты и map-state.json вьюхи. Конфиг — params метрики-вьюхи, если не передан свой.",
        params: VIEW_ARGS,
        run: (args, ctx) =>
          new Observable<ObjectsMap>((sink) => {
            const isView = isViewOf(ctx);
            const holder = viewHolder(args.view);
            let found: FoundView | undefined;
            let statePath: string | undefined;
            let state: string | undefined;
            let last = "";
            let fsWatcher: FSWatcher | undefined;
            let reading = 0;
            let closed = false;
            // Ветки карты, которые вьюха читает, — по ключу «адрес|глубина». Набор меняется вместе
            // с конфигом и состоянием: ссылка на холсте — ещё одна ветка.
            const parts = new Map<
              string,
              { arrived: boolean; value: MapObject | undefined; stop: Unsubscribable }
            >();

            const configOf = (view: FoundView) =>
              args.config ? objectsMapConfig(args.config) : view.config;

            const emit = () => {
              if (!found || statePath === undefined) return;
              const values = [...parts.values()];
              if (values.some((part) => !part.arrived)) return;
              const root = joinParts(values.map((part) => part.value));
              const value = objectsMap(root, args.view, configOf(found), parseViewState(state));
              const text = JSON.stringify(value);
              if (text === last) return;
              last = text;
              sink.next(value);
            };

            const rescope = () => {
              if (!found) return;
              const wanted = new Map(
                viewParts(configOf(found), parseViewState(state)).map((part) => [
                  `${part.address}|${part.depth}`,
                  part,
                ]),
              );
              for (const [key, part] of parts) {
                if (wanted.has(key)) continue;
                part.stop.unsubscribe();
                parts.delete(key);
              }
              for (const [key, { address, depth }] of wanted) {
                if (parts.has(key)) continue;
                const entry = {
                  arrived: false,
                  value: undefined as MapObject | undefined,
                  stop: { unsubscribe: noop } as Unsubscribable,
                };
                parts.set(key, entry);
                entry.stop = ctx.tree(address, depth).subscribe({
                  next: (value) => {
                    entry.arrived = true;
                    entry.value = value;
                    emit();
                  },
                  error: (error) => sink.error(error),
                });
              }
              emit();
            };

            const read = () => {
              const file = statePath;
              if (file === undefined) return;
              const ticket = ++reading;
              disk.read(file).then(
                (text) => {
                  // Пришёл старый ответ после нового — его не берём.
                  if (closed || ticket !== reading) return;
                  state = text;
                  rescope();
                },
                (error: unknown) => sink.error(error),
              );
            };

            const follow = (file: string) => {
              statePath = file;
              const wakers = watchers.get(file) ?? new Set();
              wakers.add(read);
              watchers.set(file, wakers);
              try {
                // Состояние правят и мимо плагина: человек в редакторе, git.
                fsWatcher = watch(dirname(file), (_event, name) => {
                  if (!name || slash(String(name)) === file.split("/").at(-1)) read();
                });
                fsWatcher.on("error", () => {});
              } catch {
                // Папки нет — у наследника, чья вьюха ещё ни разу не правилась. Запись плагина
                // разбудит вьюху сама.
              }
              read();
            };

            // Конфиг и состояние вьюхи — у объекта, которому принадлежит её метрика: читается он
            // один, без детей.
            const own =
              holder === undefined
                ? undefined
                : ctx.tree(holder, 0).subscribe({
                    next: (object) => {
                      const view = object
                        ? findView(object, args.view, isView)
                        : `Вьюхи ${args.view} нет`;
                      if (typeof view === "string") {
                        sink.error(new Error(view));
                        return;
                      }
                      found = view;
                      if (statePath === undefined) follow(view.statePath);
                      else rescope();
                    },
                    error: (error) => sink.error(error),
                  });
            if (holder === undefined) sink.error(new Error(`Вьюхи ${args.view} нет`));
            return () => {
              closed = true;
              own?.unsubscribe();
              for (const part of parts.values()) part.stop.unsubscribe();
              parts.clear();
              fsWatcher?.close();
              if (statePath !== undefined) watchers.get(statePath)?.delete(read);
            };
          }),
      },

      edit: {
        kind: "mutation",
        description:
          "Править карту теми же операциями, что человек на холсте: создать объект, провести связь, перенести объект в группу, " +
          "переименовать, удалить, скопировать объекты с детьми и внутренними связями, добавить и убрать ссылку во вьюхе, " +
          "поставить и убрать копию-отображение, сдвинуть узлы, поставить фигуру. Операции применяются по очереди одной пачкой, " +
          "каждая — по карте, где уже есть сделанное предыдущими; отказ любой откатывает всю пачку. Саму карту правит платформа " +
          "(как edit_map), адреса в связях, прототипах и конфигах переписывает она, а состояние вьюх — этот плагин. " +
          "view — адрес метрики-вьюхи, умолчание для операций без своего. В ответе id пачки — по нему undo; стек отмены держи сам.",
        params: EDIT,
        result: EditResult,
        run: (args, ctx) => defer(() => serial(() => edit(ctx, args.view, args.ops))),
      },

      undo: {
        kind: "mutation",
        description:
          "Отменить пачку edit по её id — и состояние вьюх, и правку карты. Файлы, которые с тех пор поменяли мимо неё, " +
          "не затираются: отказ с их перечнем. Пачки живут в памяти процесса плагина — после его перезапуска откатывают git.",
        params: BATCH("id пачки из ответа edit"),
        result: EditResult,
        run: (args, ctx) => defer(() => serial(() => flip(ctx, args.id, "done"))),
      },

      redo: {
        kind: "mutation",
        description: "Повторить пачку, отменённую undo, — с той же проверкой файлов.",
        params: BATCH("id пачки"),
        result: EditResult,
        run: (args, ctx) => defer(() => serial(() => flip(ctx, args.id, "undone"))),
      },
    },
  });
}

export default objectsMapPlugin();
