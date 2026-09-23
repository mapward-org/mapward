import type { Observable } from "rxjs";
import type { MapMetric, MapObject, RunSource } from "@mapward/core";
import type { ServerPorts } from "../ports/index.ts";
import type { MapRef } from "../kernel/map-ref.ts";
import { MapModel, ReadMapState, WriteMapState } from "../features/map/index.ts";
import { Executor } from "../features/execution/index.ts";
import { BuildDisplay, DisplayBuilds, DisplaySchema } from "../features/displays/index.ts";
import {
  Builtins,
  CollectMetric,
  GitStatus,
  MetricCache,
  MetricStore,
  TransformMetric,
  type MetricSettings,
  type ReadOptions,
  type RunOptions,
} from "../features/metrics/index.ts";
import { RunStore } from "../features/action-runs/index.ts";
import { TurnStore, type TurnKey } from "../features/directive-turns/index.ts";
import {
  CreateDirective,
  DeleteDirective,
  DirectiveLocator,
  DirectiveState,
  DirectiveThread,
  FinishDirective,
  ReadStage,
  RunDirective,
  StageRequest,
} from "../features/directives/index.ts";

export type MapServer = ReturnType<typeof createMapServer>;

/**
 * Сервер карты: юзкейсы, собранные вместе — решения 0015 и 0041.
 *
 * Ничего платформенного здесь нет, всё приходит портами. Поэтому один и тот же сервер живёт в
 * расширении и в cli, а его подписки одинаково работают через любой транспорт.
 */
export type ServerSettings = MetricSettings;

/**
 * Сборка вручную, в одном месте — решение 0041: явные создания в порядке зависимостей, без
 * контейнера. Связку портов получает только она и раздаёт каждому классу его порты; фичи друг
 * друга не знают, их порты стыкуются здесь.
 */
export function createMapServer(ports: ServerPorts, settings: ServerSettings = {}) {
  const { files, shell, agent, clock, timers, env } = ports;

  // Карта — одна на сервер, и все записи сервера в неё идут через неё: тот, кто записал,
  // следом читает модель и должен видеть своё, не дожидаясь вотчера.
  const map = new MapModel(files, files, timers, clock);
  const writer = map.writer(files);

  const executor = new Executor(shell, agent);
  const schema = new DisplaySchema(files);
  const displays = new DisplayBuilds(
    map,
    new BuildDisplay(files, clock, ports.bundler),
    files,
    timers,
    clock,
  );

  // Кэш метрик в модель карты не входит, и перечитывать её ради своей записи незачем: пишет
  // он мимо неё, а вотчер увидит сам.
  const cache = new MetricCache(files, files);
  const builtins = new Builtins(new GitStatus(shell, files, env, timers, clock));

  // Прогоны метрик и экшонов — одна история (решение 0038). Стор метрик сообщает о своих, а
  // хранилище прогонов после успешного экшона просит его пересобрать метрики: ссылка по кругу,
  // поэтому стор берётся через замыкание — к первому прогону он уже есть.
  const runs = new RunStore(
    files,
    executor,
    map,
    { run: (ref, address) => metrics.run(ref, address, { wait: false, source: "action" }) },
    env,
    timers,
    clock,
  );
  const metrics = new MetricStore(
    map,
    cache,
    new CollectMetric(files, cache, schema, executor, env, clock),
    new TransformMetric(builtins, cache, schema, executor, env, clock),
    builtins,
    schema,
    timers,
    clock,
    settings,
    runs,
  );

  const turns = new TurnStore();
  const locator = new DirectiveLocator(map);
  const state = new DirectiveState(files, writer);
  const createDirective = new CreateDirective(writer);
  const deleteDirective = new DeleteDirective(files, writer);
  const readStage = new ReadStage(locator, files);
  const stageRequest = new StageRequest(locator);
  const runDirective = new RunDirective(locator, files, state, turns);
  const finishDirective = new FinishDirective(
    locator,
    new DirectiveThread(files, writer),
    state,
    turns,
  );
  const readMapState = new ReadMapState(files);
  const writeMapState = new WriteMapState(writer);

  return {
    capabilities: () => ports.capabilities,

    getMap: (ref: MapRef): Promise<MapObject> => map.current(ref),

    /**
     * Карту правят руками и агентами, поэтому источник истины — файловая система. Подписчик
     * сразу получает то, что есть, потом каждое изменение: модель одна на сервер и следит за
     * картой сама (решение 0041).
     */
    watchMap: (ref: MapRef): Observable<MapObject> => map.watch(ref),

    /**
     * Перечитать карту — кнопка рядом с навигацией, как в браузере (решение 0041): для того,
     * что вотчер пропустил.
     */
    reloadMap: (ref: MapRef): Promise<void> => map.reload(ref),

    /**
     * Файлы карты для клиента — решение 0041: у клиента та же живая модель, и файлы он читает
     * сам, по подписке, из того же чтения, что у сервера. Только внутри папки карты.
     */
    watchMapFile: (params: MapRef & { path: string }) => map.watchFile(params, params.path),
    watchMapFolder: (params: MapRef & { path: string }) => map.watchFolder(params, params.path),

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
    readIndexFile: (objectPath: string) => files.read(`${objectPath}/_index.json`),

    /** Любой файл карты по пути из модели: текст директивы и экшона живут именно так. */
    readMapFile: (path: string) => files.read(path),

    /** Текст этапа без его запуска. */
    readStage: (params: MapRef & { address: string; stage: string }) => readStage.run(params),

    /**
     * Почему метрика красная, написано в логах прогона, а не во флаге `ok`. Читаются они по
     * просьбе: логи жирные, и в каждый ответ им не место — решение 0016.
     */
    readMetricLogs: (metric: MapMetric) => cache.readLogs(metric),

    createDirective: (params: { objectPath: string; title: string }) => createDirective.run(params),

    /**
     * Случайно созданная директива должна уметь исчезнуть, иначе список копит мусор. Вместе
     * с файлом уходит и состояние её прогонов: оно про директиву, которой больше нет.
     */
    deleteDirective: (params: { objectPath: string; directive: string }) =>
      deleteDirective.run(params),

    /** Фраза для кнопки этапа: хост отправляет её в живую сессию. */
    stageRequest: (params: MapRef & { address: string; directive: string; stage: string }) =>
      stageRequest.run(params),

    /** Взять директиву в работу: промпт этапа плюс отметка, что прогон начался. */
    runDirective: (
      params: MapRef & { address: string; directive: string; stage?: string; known?: string },
    ) => runDirective.run(params),

    /** Этап закончен. Помечает ли это директиву выполненной, решает сам этап. */
    finishDirective: (
      params: MapRef & { address: string; directive: string; stage?: string; reply?: string },
    ) => finishDirective.run(params),

    /**
     * Директивы, где ход у человека, — решение 0034. Живёт в памяти: перезапуск его стирает, и
     * так и задумано — это стек текущей работы, а не архив.
     */
    watchTurns: () => turns.watch(),

    /** Человек открыл пункт — ход взят, как если бы он запустил следующий этап. */
    dismissTurn: (params: TurnKey) => {
      turns.taken(params);
    },

    getMapState: (params: { mapPath: string }) => readMapState.run(params),
    setMapState: (params: { mapPath: string; value: unknown }) => writeMapState.run(params),
  };
}
