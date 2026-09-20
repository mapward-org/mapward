import { Observable } from "rxjs";
import { findObject } from "@mapward/core";
import type { MapMetric, MapObject, MapStage } from "@mapward/core";
import type { ServerPorts } from "../ports/index.ts";
import { readMap } from "../features/map-object/application/use-cases/read-map.ts";
import { frontmatter } from "../lib/frontmatter.ts";
import {
  createMetricStore,
  type MapRef,
  type ReadOptions,
  type RunOptions,
} from "../features/map-object/application/services/metric-store.ts";
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
  const metrics = createMetricStore(ports, read, settings);

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

    watchMetrics: (params: MapRef & { address?: string }) => metrics.watch(params, params.address),

    runMetric: (params: MapRef & { metric: string } & RunOptions) =>
      metrics.run(params, params.metric, params),

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

      return { stage: stage.name, done: stage.marksDone };
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
  /(collect|transform)(\.logs)?\.json$|map-state\.json$/.test(path.replaceAll("\\", "/"));
