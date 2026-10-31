/**
 * Плагин карты: долгоживущий процесс со своим состоянием, который платформа поднимает на
 * первое обращение и через который ходят метрики, экшоны и агент.
 *
 * Здесь только типы: и плагин, и платформа говорят ими, а код рантайма лежит в `runtime.ts` и
 * едет в каждую сборку плагина целиком.
 */

import type { MapEditOp, MapEditResult, MapObject, RunMessage } from "@mapward/core";
import type { Observable } from "rxjs";
import type { Static, TSchema } from "typebox";

/** Объект карты целиком — как его видит сама платформа: с метриками, слоями и детьми. */
export type { MapEditOp, MapEditResult, MapObject };

/** Объект карты так, как его видит плагин: после мерджа `extends` и подстановок. */
export type PluginObject = {
  address: string;
  name: string;
  /** Папка объекта на диске. */
  path: string;
  /** Имя прототипа, если есть. */
  prototype?: string;
  props: Record<string, unknown>;
  /** Адреса детей. Сами дети — `ctx.children`. */
  children: string[];
};

/** Карта, которой служит процесс: один процесс — одна карта. */
export type PluginMap = {
  name: string;
  /** Папка карты — `mapward://`. */
  mapPath: string;
  /** Корень проекта — `mapward://@`. */
  basePath: string;
};

/**
 * Редактор — только через плагин, и только когда он есть. Набор короткий: весь API VS Code через
 * границу процессов не пройдёт, а `executeCommand` — выход ко всему остальному.
 */
export type PluginVscode = {
  openFile(path: string, options?: { line?: number; column?: number }): Promise<void>;
  /** Показать файл или папку в проводнике редактора — так «открывают» папку. */
  reveal(path: string): Promise<void>;
  showMessage(text: string, level?: "info" | "warning" | "error"): Promise<void>;
  terminal(command: string, options?: { name?: string; cwd?: string }): Promise<void>;
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
};

/**
 * Клиент карты, каким его видит человек: сборка вебвью и мост до платформы. Есть, только если
 * платформу поднял редактор, — им рисует метрику плагин `screenshot`.
 */
export type PluginWebview = {
  /** Папка сборки вебвью: `webview.mjs`, `webview.css`, `codicon.ttf`. */
  assets: string;
  /**
   * Мост до платформы по http: `GET <bridge>?session=…` — поток событий (server-sent events) с
   * ответами платформы, `POST <bridge>?session=…` — сообщение клиента. Сообщения — те же
   * конверты, что ходят между вебвью и редактором.
   */
  bridge: string;
};

/** Клиент другого плагина: те же методы, вызов идёт через платформу. */
export type PluginClient = {
  call<T = unknown>(method: string, args?: unknown): Observable<T>;
};

/**
 * Всё API платформы для плагина. Глобального нет: метод — функция от аргументов и контекста, и
 * в тесте контекст подсовывается поддельный.
 */
export type PluginCtx = {
  /** Синхронно — то, что известно с рукопожатия. */
  readonly map: PluginMap;
  /** Своя папка; она же рабочая папка процесса. */
  readonly pluginDir: string;
  /**
   * Путь из адреса карты: `mapward://packages/core` — папка в карте, `mapward://@/src` — от
   * корня проекта, `mapward://~/…` — от `from`. Адрес с решёткой — это значение, а не путь:
   * его даёт `object`.
   */
  resolve(address: string, from?: string): string;
  log(...parts: unknown[]): void;
  /** Платформу поднял VS Code. */
  readonly isVscode: boolean;
  /** Редактор. Без него обращение бросает ошибку — проверяйте `isVscode`. */
  readonly vscode: PluginVscode;
  /** Клиент карты для отрисовки вне редактора; нет — платформу подняли без редактора. */
  readonly webview: PluginWebview | undefined;
  /** Асинхронно, потоком — то, что знает модель карты. Объекта нет — `undefined`. */
  object(address: string): Observable<PluginObject | undefined>;
  children(address: string): Observable<PluginObject[]>;
  /**
   * Поддерево карты от адреса, потоком: объект с потомками на `depth` уровней (`0` — без детей,
   * `1` — дети без внуков, `Infinity` — все), с метриками и слоями — как его видит платформа.
   * Нужен тому, кто считает по карте сам: вьюхе, правке. Объекта нет — `undefined`. Глубина
   * обязательна: всё, что под адресом, платформа держит прочитанным и под вотчером, пока поток
   * жив, и `Infinity` от корня — это вся карта.
   */
  tree(address: string, depth: number): Observable<MapObject | undefined>;
  /** Другой плагин по пути от своей папки или абсолютному. */
  plugin(path: string): PluginClient;
  /**
   * Правка карты — базовый набор платформы, тот же, что у интерфейса и агента: свои поля по
   * адресу (`get`/`set`/`delete` объекта, метрики, экшона, слоя, этапа), структура (`create`,
   * `move`, `setFolder`, `copy`), сырые файлы (`readFile`/`writeFile`/`removeFile`), `check` и
   * `installDeps`. Пачка ложится целиком или никак; ответы операций — `results` по порядку.
   * Перенос сам переписывает адреса в `_index.json` и `config.json` карты, а свои файлы с
   * адресами плагин переписывает по `moves` из ответа. Записанное модель видит к ответу.
   */
  editMap(ops: MapEditOp[]): Promise<MapEditResult>;
  /** Отменить пачку по номеру; файлы, поменянные мимо неё, не затираются — отказ. */
  undoEdit(id: string): Promise<MapEditResult>;
  redoEdit(id: string): Promise<MapEditResult>;
};

/**
 * JSON-схема — для самоописания: агент видит не TypeScript, а её. Объект любого вида: схема
 * typebox (`Type.Object(…)`), записанная руками или собранная другой библиотекой схем.
 */
export type JsonSchema = object | boolean;

/**
 * Тип значения по схеме. Схема typebox и JSON-схема, которую TypeScript видит буквально, дают
 * свой тип — `Static` typebox; схемы нет или она безлика — `unknown`, и тип берётся из подписи.
 */
export type FromSchema<S> = unknown extends S ? unknown : S extends TSchema ? Static<S> : unknown;

export type MethodKind = "query" | "mutation";

export type MethodDefinition<Args = never, Value = unknown> = {
  /** Читающий или изменяющий — для агента и формы экшона. По умолчанию `query`. */
  kind?: MethodKind;
  description?: string;
  params?: JsonSchema;
  result?: JsonSchema;
  /**
   * Поток значений — `Observable` из rxjs, который даёт платформа. Запрос это или подписка,
   * решает плагин: одиночный ответ — поток из одного значения, который сразу кончился (`of`,
   * `defer(async () => …)`).
   */
  run(args: Args, ctx: PluginCtx): Observable<Value>;
};

/**
 * Шаблон метрики — готовый вид, который плагин даёт карте: компонент из его папки, схема
 * `params` и то, что видит агент. Метрику по шаблону пишут короткой формой
 * `{ label?, plugin, template, params }` — платформа разворачивает её в `component` и `agent`
 * и проверяет `params` схемой шаблона.
 */
export type MetricTemplate = {
  /** Компонент вида — путь от папки плагина: `list.tsx`. */
  component: string;
  description?: string;
  /** JSON-схема `params` метрики. */
  params?: JsonSchema;
  /**
   * Запрос для агента. `{ method, params?, metric? }` — метод этого плагина; `metric` — имя
   * аргумента, в который платформа кладёт адрес самой метрики (так вьюха холста знает, чья она).
   * `{ param }` — запрос лежит в параметре метрики как `{ plugin, method, params }`: так у
   * видов, которым данные даёт `params.source`.
   */
  agent?: { method: string; params?: Record<string, unknown>; metric?: string } | { param: string };
};

/**
 * Когда поднимать процесс. По умолчанию — на первое обращение, а гасить после простоя.
 * `withMap` — вместе с картой, чтобы прогреться заранее; `idle: false` — не гасить вовсе.
 */
export type Activation = { withMap?: boolean; idle?: number | false };

// Методы с разными аргументами в одной записи: `any` здесь — граница, а не небрежность.
// oxlint-disable-next-line typescript/no-explicit-any
export type AnyMethod = MethodDefinition<any, any>;

export type PluginDefinition<
  Methods extends Record<string, AnyMethod> = Record<string, AnyMethod>,
> = {
  description?: string;
  activation?: Activation;
  /** Готовые виды метрики по имени — см. `MetricTemplate`. */
  templates?: Record<string, MetricTemplate>;
  /** Прогрев: строит состояние до первого вызова. */
  init?(ctx: PluginCtx): void | Promise<void>;
  /** Вежливость перед остановкой, а не гарантия: процесс могут убить и без неё. */
  dispose?(ctx: PluginCtx): void | Promise<void>;
  methods: Methods;
};

/** Что плагин рассказывает о себе на рукопожатии: по этому его видят MCP и форма экшона. */
export type PluginDescription = {
  description?: string;
  activation: Activation;
  methods: Record<
    string,
    { kind: MethodKind; description?: string; params?: JsonSchema; result?: JsonSchema }
  >;
  /** Шаблоны метрик; нет — поля нет. */
  templates?: Record<string, MetricTemplate>;
};

/**
 * Протокол поверх stdio: строка — один json. Вызовы платформы и просьбы плагина номеруются
 * отдельно, поэтому ответы у них свои.
 */
export type PlatformMessage =
  | {
      t: "hello";
      map: PluginMap;
      pluginDir: string;
      isVscode: boolean;
      webview?: PluginWebview;
    }
  | { t: "call"; id: string; method: string; args: unknown }
  | { t: "cancel"; id: string }
  | { t: "shutdown" }
  | { t: "rnext"; id: string; value: unknown }
  | { t: "rerror"; id: string; message: string }
  | { t: "rcomplete"; id: string };

export type PluginRequest =
  | { op: "object"; address: string }
  | { op: "children"; address: string }
  /** `depth: null` — все уровни: `Infinity` JSON не переносит. */
  | { op: "tree"; address: string; depth: number | null }
  | { op: "plugin"; path: string; method: string; args: unknown }
  | { op: "editMap"; ops: MapEditOp[] }
  /** Номер пачки — `batch`: `id` у просьбы уже свой. */
  | { op: "undoEdit"; batch: string }
  | { op: "redoEdit"; batch: string }
  | { op: "vscode"; method: string; args: unknown[] };

export type PluginMessage =
  | { t: "ready"; description: PluginDescription }
  | { t: "failed"; message: string }
  | { t: "next"; id: string; value: unknown }
  | { t: "error"; id: string; message: string }
  | { t: "complete"; id: string }
  | ({ t: "request"; id: string } & PluginRequest)
  | { t: "release"; id: string }
  | { t: "disposed" };

/**
 * Что `definePlugin` выводит по схемам метода: `params` — тип `args`, `result` — тип значений
 * потока; сообщения о ходе (`RunMessage`) идут мимо `result` — их платформа пишет в прогон. Две
 * записи, а не одна: TypeScript выводит по ключам только один параметр на запись.
 */
export type WithParams<P> = Omit<MethodDefinition, "params" | "run"> & {
  params?: P;
  run(args: FromSchema<P>, ctx: PluginCtx): Observable<unknown>;
};
export type WithResult<R> = Omit<MethodDefinition, "result" | "run"> & {
  result?: R;
  run(args: never, ctx: PluginCtx): Observable<FromSchema<R> | RunMessage>;
};

/** Методы плагина как их видит клиент: `usePlugin<typeof plugin>` берёт типы отсюда. */
export type MethodsOf<P> = P extends PluginDefinition<infer M> ? M : never;
export type ArgsOf<M> = M extends MethodDefinition<infer A, unknown> ? A : never;
export type ValueOf<M> = M extends MethodDefinition<never, infer V> ? V : never;
/** Тип `params` метрики по шаблону плагина — из схемы шаблона: `MetricProps<TemplateParams<…>>`. */
export type TemplateParams<P, Name extends string> = P extends {
  templates?: infer T;
}
  ? T extends Record<Name, { params?: infer S }>
    ? FromSchema<S>
    : unknown
  : unknown;
