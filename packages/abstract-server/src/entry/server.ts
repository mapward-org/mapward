import { Observable } from "rxjs";
import { findObject } from "@mapward/core";
import type { MapMetric, MapObject, MapStage, RunSource } from "@mapward/core";
import type { ServerPorts } from "../ports/index.ts";
import { readMap } from "../features/map-object/application/use-cases/read-map.ts";
import { frontmatter } from "../lib/frontmatter.ts";
import {
  createMetricStore,
  type MapRef,
  type ReadOptions,
  type RunOptions,
} from "../features/map-object/application/services/metric-store.ts";
import { createDisplayBuilds } from "../features/map-object/application/services/display-builds.ts";
import {
  createDirective,
  deleteDirective,
  finishStage,
  startStage,
} from "../features/map-object/application/use-cases/directives.ts";
import {
  stagePrompt,
  stageRequest,
  defaultStageText,
} from "../features/map-object/domain/prompts.ts";
import {
  readMapState,
  writeMapState,
} from "../features/map-object/application/use-cases/map-state.ts";
import { createTurnStore, type TurnKey } from "../features/directive-turns/index.ts";
import { createRunStore } from "../features/action-runs/index.ts";

export type MapServer = ReturnType<typeof createMapServer>;

/**
 * Сервер карты: юзкейсы, собранные вместе — решение 0015.
 *
 * Ничего платформенного здесь нет, всё приходит портами. Поэтому один и тот же сервер живёт в
 * расширении и в cli, а его подписки одинаково работают через любой транспорт.
 */
export type ServerSettings = {
  /** Сколько метрик собирать разом; без него — без лимита (решение 0013). */
  metricsConcurrency?: number;
  /**
   * Сколько собранное считается свежим — умолчание для всех метрик карты, которое метрика
   * перебивает своим (решение 0016). Без него каждое открытие пересобирает всё заново.
   */
  collectorsStaleTime?: number;
  transformsStaleTime?: number;
};

export function createMapServer(ports: ServerPorts, settings: ServerSettings = {}) {
  const read = (ref: MapRef) => readMap(ports.files, ref.mapPath, ref.basePath, ref.name);
  // Прогоны метрик и экшонов — одна история (решение 0038). Стор метрик сообщает о своих, а
  // хранилище прогонов после успешного экшона просит его пересобрать метрики: ссылка по кругу,
  // поэтому стор берётся через замыкание — к первому прогону он уже есть.
  const runs = createRunStore(ports, {
    readMap: read,
    runMetric: (ref, address) => metrics.run(ref, address, { wait: false, source: "action" }),
  });
  const metrics = createMetricStore(ports, read, settings, runs);
  const displays = createDisplayBuilds(ports, read);
  const turns = createTurnStore();

  /** Объект, директива и действующие на нём этапы — всё из модели, а не склейкой путей. */
  const locate = async (params: MapRef & { address: string; directive: string }) => {
    const map = await read(params);
    const object = findObject(map, params.address);
    if (!object) throw new Error(`Объект ${params.address} не найден`);
    const file = object.directives.find((entry) => entry.name === params.directive);
    if (!file) {
      const known = object.directives.map((entry) => entry.name).join(", ");
      throw new Error(`У объекта нет директивы ${params.directive}. Есть: ${known || "ни одной"}.`);
    }
    return { object, file, stages: object.workflow };
  };

  return {
    capabilities: () => ports.capabilities,

    getMap: (ref: MapRef): Promise<MapObject> => read(ref),

    /**
     * Карту правят руками и агентами, поэтому источник истины — файловая система. Свои же
     * записи — кэши метрик и положение узлов — вотчер пропускает: иначе запись вызывала бы
     * перечитывание, оно новый сбор, а тот новую запись.
     */
    watchMap: (ref: MapRef): Observable<MapObject> =>
      new Observable((subscriber) => {
        const push = () => void read(ref).then((map) => subscriber.next(map));
        const stop = ports.files.watch(ref.mapPath, (path) => {
          if (!ourOwnWrite(path)) push();
        });
        push();
        return stop;
      }),

    /**
     * Группа — это вкладка объекта: метрики вне неё не собираются вовсе (решение 0025).
     * Названные ключи бьют группу — так подписывается таб одной метрики (решение 0026).
     */
    watchMetrics: (params: MapRef & { address?: string; group?: string; metrics?: string[] }) =>
      metrics.watch(params, params.address, {
        ...(params.group === undefined ? {} : { group: params.group }),
        ...(params.metrics === undefined ? {} : { metrics: params.metrics }),
      }),

    /**
     * Собранный компонент метрики — решение 0037. Пересобирается сам, когда меняется компонент
     * или то, что он импортирует; подписка приносит новую сборку.
     */
    watchDisplay: (params: MapRef & { metric: string }) => displays.watch(params, params.metric),

    /** Сборка без слежки: ей отвечает `mapward display check`. */
    buildDisplay: (params: MapRef & { metric: string }) =>
      displays.buildOnce(params, params.metric),

    runMetric: (params: MapRef & { metric: string } & RunOptions & { wait?: boolean }) =>
      metrics.run(params, params.metric, params),

    /**
     * Запустить экшон — решение 0038. Номер прогона уходит сразу, прогон идёт у сервера; поля
     * формы проверяются здесь, и при ошибке прогона нет, а в ответе — что не так с полями.
     */
    runAction: (
      params: MapRef & { action: string; inputs?: Record<string, unknown>; source?: RunSource },
    ) => runs.start(params, params.action, params.inputs, params.source),

    stopRun: (params: { mapPath: string; id: string }) => {
      runs.stop(params.mapPath, params.id);
    },

    /** Дождаться конца прогона: MCP и терминал зовут экшон ради итога, а не номера. */
    waitRun: (params: { mapPath: string; id: string }) => runs.wait(params.mapPath, params.id),

    /** Прогон по номеру, как он есть сейчас: `wait: false` досматривается этим. */
    readRun: (params: { mapPath: string; id: string }) => runs.find(params.mapPath, params.id),

    /** Прогоны объекта, свежие сверху, — экран прогонов. */
    watchRuns: (params: { mapPath: string; address: string }) =>
      runs.watch(params.mapPath, params.address),

    /**
     * Что показано сейчас: этим MCP отдаёт метрики в собранном виде. Без опций — только кэш,
     * с `refresh: "on-display"` дешёвое досчитывается (решение 0016).
     */
    readMetrics: (ref: MapRef, object: MapObject, options?: ReadOptions) =>
      metrics.read(ref, object, options),

    /** Объект файлом, как он написан на диске — решение 0009: агент видит и мердж, и исходник. */
    readIndexFile: (objectPath: string) => ports.files.read(`${objectPath}/_index.json`),

    /** Любой файл карты по пути из модели: текст директивы и экшона живут именно так. */
    readMapFile: (path: string) => ports.files.read(path),

    /**
     * Текст этапа без его запуска. Запуск ставит отметку о прогоне, и раньше это был
     * единственный способ прочитать этап: агент, которому нужно было посмотреть на соседний
     * этап, либо заводил прогон, которого не было, либо шёл читать файл мимо карты — а у
     * дефолтного этапа файла нет вовсе.
     *
     * Читает сервер, а не MCP: имя этапа ищется в модели объекта, включая доставшиеся от
     * прототипа, ровно как при запуске.
     */
    readStage: async (params: MapRef & { address: string; stage: string }) => {
      const map = await read(params);
      const object = findObject(map, params.address);
      if (!object) throw new Error(`Объект ${params.address} не найден`);

      const stage = pickStage(object.workflow, params.stage);
      if (!stage) {
        const known = object.workflow.map((entry) => `«${entry.name}»`).join(", ");
        throw new Error(`У объекта нет этапа ${params.stage}. Есть: ${known || "ни одного"}.`);
      }

      const text = stage.path
        ? ((await ports.files.read(stage.path)) ?? "")
        : defaultStageText(stage.name);

      return {
        name: stage.name,
        order: stage.order,
        marksDone: stage.marksDone,
        // У дефолтного этапа файла нет: текст лежит в самом инструменте, и править его негде.
        ...(stage.path === "" ? { builtin: true } : { path: stage.path }),
        ...(stage.owner === undefined ? {} : { owner: stage.owner }),
        // Тело без frontmatter — то же, что уезжает в промпт прогона.
        text: body(text),
      };
    },

    /**
     * Почему метрика красная, написано в логах прогона, а не во флаге `ok`. Читаются они по
     * просьбе: логи жирные, и в каждый ответ им не место — решение 0016.
     */
    readMetricLogs: async (metric: MapMetric) => {
      const [collect, transform] = await Promise.all([
        ports.files.read(`${metric.cachePath}/collect.logs.json`),
        ports.files.read(`${metric.cachePath}/transform.logs.json`),
      ]);
      if (collect === undefined && transform === undefined) return undefined;
      return {
        ...(collect === undefined ? {} : { collect }),
        ...(transform === undefined ? {} : { transform }),
      };
    },

    createDirective: (params: { objectPath: string; title: string }) =>
      createDirective(ports, params),

    /**
     * Случайно созданная директива должна уметь исчезнуть, иначе список копит мусор. Вместе
     * с файлом уходит и состояние её прогонов: оно про директиву, которой больше нет.
     */
    deleteDirective: (params: { objectPath: string; directive: string }) =>
      deleteDirective(ports, params),

    /**
     * Фраза для кнопки этапа: хост отправляет её в живую сессию, агент по ней зовёт
     * `runDirective` сам. Составляет её сервер, а не кнопка, — решение 0017.
     */
    stageRequest: async (
      params: MapRef & { address: string; directive: string; stage: string },
    ) => {
      const found = await locate(params);
      const stage = pickStage(found.stages, params.stage);
      if (!stage) {
        const known = found.stages.map((entry) => `«${entry.name}»`).join(", ");
        throw new Error(`У объекта нет этапа ${params.stage}. Есть: ${known}.`);
      }
      return {
        text: stageRequest({ object: found.object, directive: found.file.name, stage: stage.name }),
      };
    },

    /**
     * Взять директиву в работу: промпт этапа плюс отметка, что прогон начался — решение 0017.
     * Один вызов вместо двух потому, что промпт без отметки означал бы прогон, которого карта
     * не видит, а это ровно то, от чего уходили.
     */
    runDirective: async (
      params: MapRef & { address: string; directive: string; stage?: string },
    ) => {
      const found = await locate(params);
      const stage = pickStage(found.stages, params.stage);
      if (!stage) {
        const known = found.stages.map((entry) => `«${entry.name}»`).join(", ");
        throw new Error(`У объекта нет этапа ${String(params.stage)}. Есть: ${known}.`);
      }

      const text = stage.path
        ? ((await ports.files.read(stage.path)) ?? "")
        : defaultStageText(stage.name);

      await startStage(ports, {
        objectPath: found.object.path,
        directive: found.file.name,
        stage: stage.name,
        now: new Date(),
      });
      // Этап начался — человек взял ход, директива больше не ждёт ответа (решение 0034).
      turns.taken({
        mapPath: params.mapPath,
        address: found.object.address,
        directive: found.file.name,
      });

      return {
        stage: stage.name,
        marksDone: stage.marksDone,
        directive: found.file.path,
        prompt: stagePrompt({
          stage,
          text: body(text),
          hook: found.object.workflowPrompt,
          directivePath: found.file.path,
          object: found.object,
          mapPath: params.mapPath,
        }),
      };
    },

    /** Этап закончен. Помечает ли это директиву выполненной, решает сам этап. */
    finishDirective: async (
      params: MapRef & { address: string; directive: string; stage?: string },
    ) => {
      const found = await locate(params);
      const stage = pickStage(found.stages, params.stage);
      if (!stage) throw new Error(`У объекта нет этапа ${String(params.stage)}`);

      await finishStage(ports, {
        objectPath: found.object.path,
        directivePath: found.file.path,
        directive: found.file.name,
        stage: stage.name,
        marksDone: stage.marksDone,
        now: new Date(),
      });
      // Ход у человека. Кладётся после записи состояния: не записалось — ждать нечего.
      turns.finished({
        mapPath: params.mapPath,
        address: found.object.address,
        object: found.object.name,
        directive: found.file.name,
        path: found.file.path,
        stage: stage.name,
        at: new Date().toISOString(),
      });

      return { stage: stage.name, done: stage.marksDone };
    },

    /**
     * Директивы, где ход у человека, — решение 0034. Живёт в памяти: перезапуск его стирает, и
     * так и задумано — это стек текущей работы, а не архив.
     */
    watchTurns: () => turns.watch(),

    /** Человек открыл пункт — ход взят, как если бы он запустил следующий этап. */
    dismissTurn: (params: TurnKey) => {
      turns.taken(params);
    },

    getMapState: (params: { mapPath: string }) => readMapState(ports, params),
    setMapState: (params: { mapPath: string; value: unknown }) => writeMapState(ports, params),
  };
}

/** Этап зовут по имени; без имени берётся первый по порядку. Регистр не важен. */
const pickStage = (stages: MapStage[], wanted: string | undefined): MapStage | undefined =>
  wanted === undefined
    ? stages[0]
    : stages.find((stage) => stage.name.toLowerCase() === wanted.trim().toLowerCase());

/** Тело файла этапа без frontmatter: в промпт едет промпт, а не его настройки. */
const body = (text: string) => frontmatter(text).body;

/** Файлы, которые пишет сама карта: их изменение не повод перечитывать её заново. */
const ourOwnWrite = (path: string) =>
  /(collect|transform)(\.logs)?\.json$|map-state\.json$|\/\.mapward\//.test(
    path.replaceAll("\\", "/"),
  );
