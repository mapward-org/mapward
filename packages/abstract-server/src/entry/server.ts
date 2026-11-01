import { endWith, firstValueFrom, map as mapStream, type Observable } from "rxjs";
import { MAP_ROOT } from "@mapward/core";
import type { MapEditOp, PluginEvent, RunSource } from "@mapward/core";
import { builtinPlugins } from "@mapward/plugins";
import type { ServerPorts } from "../ports/index.ts";
import type { MapRef } from "../kernel/map-ref.ts";
import { ActionConfig, MapModel, MetricConfig, ObjectIndex } from "../features/map/index.ts";
import {
  ApplySteps,
  CheckTarget,
  EditHistory,
  EditMap,
  FieldOps,
  ToggleEdit,
} from "../features/map-edits/index.ts";
import {
  BUILD_STAMP,
  BuildCache,
  BuildComponent,
  ComponentBuilds,
} from "../features/components/index.ts";
import { RunStore } from "../features/action-runs/index.ts";
import {
  DEFAULT_REGISTRY,
  Market,
  REGISTRY_ENV,
  type MarketKind,
} from "../features/market/index.ts";
import { basename } from "../lib/path.ts";
import { BuildPlugin, CheckPlugin, InstallPlugin, PluginHost } from "../features/plugins/index.ts";
import { TurnStore, type TurnKey } from "../features/directive-turns/index.ts";
import {
  CreateDirective,
  DeleteDirective,
  DirectiveLocator,
  DirectiveState,
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
 *
 *
 * Сборка вручную, в одном месте — решение 0041: явные создания в порядке зависимостей, без
 * контейнера. Связку портов получает только она и раздаёт каждому классу его порты; фичи друг
 * друга не знают, их порты стыкуются здесь.
 */
export function createMapServer(ports: ServerPorts) {
  const { files, clock, timers, env } = ports;

  // Карта — одна на сервер, и все записи сервера в неё идут через неё: тот, кто записал,
  // следом читает модель и должен видеть своё, не дожидаясь вотчера.
  const map = new MapModel(files, files, timers, clock);
  const writer = map.writer(files);

  // Правка карты — базовый набор платформы: перенос переписывает адреса по всей карте, поэтому
  // план считается по модели целиком. Переносы и удаления папок идут мимо `writer`, и тронутое
  // модель перечитывает сама (`refresh`): следующая операция пачки видит своё.
  const editSource = {
    current: async (ref: MapRef) => {
      const root = await map.subtree(ref, MAP_ROOT, Infinity);
      if (!root) throw new Error(`карта ${ref.mapPath} не читается`);
      return root;
    },
    refresh: (paths: string[]) => map.refresh(paths),
  };
  const editHistory = new EditHistory();
  const applySteps = new ApplySteps(
    files,
    files,
    files.move ? { move: files.move.bind(files) } : undefined,
    editSource,
  );
  const undoEdit = new ToggleEdit(applySteps, editHistory, "done");
  const redoEdit = new ToggleEdit(applySteps, editHistory, "undone");

  const components = new ComponentBuilds(
    map,
    new BuildComponent(files, clock, ports.bundler),
    files,
    timers,
    clock,
    // Сборки — на диске карты, в `.mapward/builds/`: окно открывается с ними, а не со сборщиком.
    new BuildCache(files, BUILD_STAMP),
  );

  // Плагины: процесс на плагин на карту. Сборку пишет мимо `writer` — это `.mapward`, а не
  // карта, и модели перечитывать её незачем.
  // Установка встроенного тоже мимо `writer`: `_plugins` — код, а не объекты карты.
  const installPlugin = new InstallPlugin(files, ports.trust, builtinPlugins, ports.packages);
  const buildPlugin = new BuildPlugin(files, ports.bundler);
  const plugins = new PluginHost(
    map,
    buildPlugin,
    installPlugin,
    files,
    timers,
    clock,
    env,
    ports.plugins,
    ports.trust,
    ports.editor,
    ports.webview,
    {
      edit: (ref, ops) => editMap.run(ref, ops),
      undo: (ref, id) => undoEdit.run(ref, id),
      redo: (ref, id) => redoEdit.run(ref, id),
    },
  );

  // Маркетплейс: реестр и репозитории авторов — через сеть хоста; плагин ставится той же
  // установкой, что встроенный (без доверия), кусок карты — правкой карты одной пачкой.
  const market = new Market(
    files,
    ports.market,
    installPlugin,
    (ref, ops) => editMap.run(ref, ops),
    async (ref, address) => {
      const object = await map.subtree(ref, address, 1);
      if (!object) return undefined;
      return { path: object.path, children: object.children.map((child) => basename(child.path)) };
    },
    () => env.vars()[REGISTRY_ENV]?.trim() || DEFAULT_REGISTRY,
  );

  // Проверка плагина стыкует сборку, процесс, карту и сборку компонента метрики.
  const checkPlugin = new CheckPlugin({
    build: (ref, plugin) => buildPlugin.run(ref, plugin),
    describe: (ref, plugin) => plugins.describe(ref, plugin),
    first: (ref, plugin, method, args, timeout) =>
      plugins.first(ref, plugin, method, args, timeout),
    // Вся карта по смыслу: проверка ищет метрики, которые зовут плагин, где бы они ни лежали.
    // Разовое чтение по просьбе человека, а не подписка.
    map: async (ref) => {
      const root = await map.subtree(ref, MAP_ROOT, Infinity);
      if (!root) throw new Error(`карта ${ref.mapPath} не читается`);
      return root;
    },
    buildComponent: (ref, metric) => components.buildOnce(ref, metric),
  });

  // Правке нужны плагины — проверить запись по их самоописанию и шаблонам, — а плагинам правка:
  // `ctx.editMap`. Хост зовёт её лениво, поэтому собирается она после него.
  const editPlugins = {
    describe: (ref: MapRef, plugin: string) => plugins.describe(ref, plugin),
    first: (ref: MapRef, plugin: string, method: string, args: unknown, timeout: number) =>
      plugins.first(ref, plugin, method, args, timeout),
    check: (ref: MapRef, plugin: string, timeout: number) =>
      checkPlugin
        .run(ref, plugin, timeout)
        .then(({ ok, steps }) => ({ target: plugin, ok, steps })),
    installDeps: (ref: MapRef, plugin: string) => installPlugin.installDeps(ref, plugin),
  };
  const editMap = new EditMap(
    editSource,
    files,
    applySteps,
    editHistory,
    new FieldOps(
      files,
      { object: ObjectIndex, metric: MetricConfig, action: ActionConfig },
      editPlugins,
    ),
    new CheckTarget(
      {
        metric: (ref, address) => components.buildOnce(ref, address),
        layout: (ref, address, group) => components.buildLayoutOnce(ref, address, group),
        actionForm: (ref, action) => components.buildActionFormOnce(ref, action),
      },
      editPlugins,
    ),
    editPlugins,
  );

  // История прогонов — только у экшонов (решение 0038), и только у вызовов через экшон: сам
  // экшон — метод плагина, и платформа, маршрутизируя вызов, его записывает. Ленту сайдбара
  // она делит с директивами.
  const turns = new TurnStore();
  const runs = new RunStore(
    files,
    map,
    {
      describe: (ref, plugin) => plugins.describe(ref, plugin),
      call: (ref, plugin, method, args) => plugins.call(ref, plugin, method, args),
    },
    timers,
    clock,
    turns,
  );

  const locator = new DirectiveLocator(map);
  const state = new DirectiveState(files, writer);
  const createDirective = new CreateDirective(writer);
  const deleteDirective = new DeleteDirective(files, writer);
  const readStage = new ReadStage(locator, files);
  const stageRequest = new StageRequest(locator);
  const runDirective = new RunDirective(locator, files, state, turns);
  const finishDirective = new FinishDirective(locator, state, turns);
  return {
    capabilities: () => ports.capabilities,

    /**
     * Объект по адресу и `depth` уровней его детей (`0` — без детей, `Infinity` — всё под ним).
     * Читается путь к нему и то, что под ним на этой глубине; нет такого — `undefined`.
     */
    readObject: (params: MapRef & { address: string; depth: number }) =>
      map.subtree(params, params.address, params.depth),

    /** Предки объекта разово — от корня, без него самого. */
    readAncestors: (params: MapRef & { address: string }) =>
      firstValueFrom(map.ancestors(params, params.address)),

    /**
     * Перечитать карту — кнопка рядом с навигацией, как в браузере (решение 0041): для того,
     * что вотчер пропустил.
     */
    reloadMap: (ref: MapRef): Promise<void> => map.reload(ref),

    /**
     * Объект для клиента: модель карты одна — у сервера, клиент на неё смотрит. Свои поля и
     * ближайшие дети без внуков, одно значение на пачку; `null` — объекта нет.
     */
    watchObject: (params: MapRef & { address: string }) => map.view(params, params.address),

    /** Предки объекта для крошек: читаются только папки на пути. */
    watchAncestors: (params: MapRef & { address: string }) => map.ancestors(params, params.address),

    /**
     * Собранный компонент метрики — решение 0037. Пересобирается сам, когда меняется компонент
     * или то, что он импортирует; подписка приносит новую сборку.
     */
    watchComponent: (params: MapRef & { metric: string }) =>
      components.watch(params, params.metric),

    /** Собранная раскладка группы объекта: пересобирается так же, как компонент метрики. */
    watchLayout: (params: MapRef & { address: string; group: string }) =>
      components.watchLayout(params, params.address, params.group),

    /** Собранная своя форма экшона: пересобирается так же, как компонент метрики. */
    watchActionForm: (params: MapRef & { action: string }) =>
      components.watchActionForm(params, params.action),

    /**
     * Стереть сохранённые сборки компонентов карты (`.mapward/builds/` и память сервера): то, на
     * что смотрят, собирается заново. На случай, когда сверка входов чего-то не заметила.
     */
    clearBuildCache: (ref: MapRef) => components.clearCache(ref),

    /**
     * Запустить экшон — решение 0038: вызвать его метод плагина с параметрами и данными формы и
     * записать вызов в историю. Номер прогона уходит сразу, прогон идёт у сервера; поля формы
     * проверяются здесь, и при ошибке прогона нет, а в ответе — что не так с полями.
     */
    runAction: (
      params: MapRef & { action: string; inputs?: Record<string, unknown>; source?: RunSource },
    ) => runs.start(params, params.action, params.inputs, params.source),

    /** Остановить прогон — отписаться от вызова метода. */
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
     * Правка карты пачкой операций: свои поля по адресу (`get`/`set`/`delete`), структура
     * (`create`, `move`, `setFolder`, `copy`), сырые файлы, `check`, `installDeps`. Ответ — номер
     * пачки, переезды адресов и ответы операций; отмена и повтор — по номеру.
     */
    editMap: (params: MapRef & { ops: MapEditOp[] }) => editMap.run(params, params.ops),
    undoEdit: (params: MapRef & { id: string }) => undoEdit.run(params, params.id),
    redoEdit: (params: MapRef & { id: string }) => redoEdit.run(params, params.id),

    /** Объект файлом, как он написан на диске — решение 0009: агент видит и мердж, и исходник. */
    readIndexFile: (objectPath: string) => files.read(`${objectPath}/_index.json`),

    /** Любой файл карты по пути из модели: текст директивы и экшона живут именно так. */
    readMapFile: (path: string) => files.read(path),

    /** Текст этапа без его запуска. */
    readStage: (params: MapRef & { address: string; stage: string }) => readStage.run(params),

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
     * Лента в кружке сайдбара — решение 0034: идущие этапы и экшоны, директивы, где ход у
     * человека, и упавшие экшоны. Живёт в памяти: перезапуск её стирает, и так и задумано — это
     * стек текущей работы, а не архив.
     */
    watchTurns: () => turns.watch(),

    /** Человек открыл пункт — ход взят. Идущее по клику не убирается, оно уйдёт само. */
    dismissTurn: (params: TurnKey) => {
      turns.taken(params);
    },

    /**
     * Метод плагина потоком значений. Плагин — абсолютный путь к его папке. Отписка — отмена.
     */
    callPlugin: (
      params: MapRef & { plugin: string; method: string; args?: unknown },
    ): Observable<unknown> => plugins.call(params, params.plugin, params.method, params.args ?? {}),

    /** То же для моста: у моста своего конца у потока нет, конец приходит событием. */
    watchPluginCall: (
      params: MapRef & { plugin: string; method: string; args?: unknown },
    ): Observable<PluginEvent> =>
      plugins.call(params, params.plugin, params.method, params.args ?? {}).pipe(
        mapStream((value): PluginEvent => ({ kind: "next", value })),
        endWith<PluginEvent>({ kind: "complete" }),
      ),

    /**
     * Первое значение метода или отказ по сроку — так ждёт агент: бесконечно ему некогда, а
     * своих сроков платформа плагину не ставит, их называет зовущий.
     */
    pluginFirst: (
      params: MapRef & { plugin: string; method: string; args?: unknown },
      timeout: number,
    ) => plugins.first(params, params.plugin, params.method, params.args ?? {}, timeout),

    /** Все значения до конца потока — так ждут долгий изменяющий метод. */
    pluginAll: (
      params: MapRef & { plugin: string; method: string; args?: unknown },
      timeout: number,
    ) => plugins.all(params, params.plugin, params.method, params.args ?? {}, timeout),

    /** Самоописание плагина: методы, схемы, читающий или изменяющий. */
    describePlugin: (params: MapRef & { plugin: string }) =>
      plugins.describe(params, params.plugin),

    /** Хвост stderr плагина — почему он не отвечает. */
    pluginLog: (params: MapRef & { plugin: string }) => plugins.log(params, params.plugin),

    /**
     * Скопировать встроенный плагин в карту: в `_plugins/<имя>` или в названную папку внутри
     * неё. Папка уже есть — отказ: существующую копию mapward не перезаписывает никогда.
     */
    installPlugin: (params: MapRef & { name: string; path?: string }) =>
      installPlugin.run(params, params.name, params.path),

    /**
     * Работает ли плагин: сборка, процесс и рукопожатие, самоописание, метрики карты, которые на
     * него ссылаются. Ей отвечают `mapward plugin check` и `check_plugin`. `timeout` — на каждый
     * пробный запрос для агента.
     */
    checkPlugin: (params: MapRef & { plugin: string }, timeout: number) =>
      checkPlugin.run(params, params.plugin, timeout),

    /** Маркетплейс: поиск по реестру — плагины, куски карты или оба индекса. */
    marketSearch: (params: { query?: string; kind?: MarketKind }) => market.search(params),

    /** Исходники из реестра до установки: дерево файлов и README или один файл. */
    marketRead: (params: { name: string; kind?: MarketKind; path?: string; commit?: string }) =>
      market.read(params),

    /**
     * Поставить из реестра копией: плагин — в `_plugins/<имя>` без доверия (его подтверждает
     * человек), кусок карты — под родителя пачкой правки с отменой.
     */
    marketAdd: (
      params: MapRef & {
        name: string;
        kind?: MarketKind;
        path?: string;
        parent?: string;
        trusted?: boolean;
      },
    ) => market.add(params, params),

    /** Установленное против записанного коммита и ветки автора. */
    marketDiff: (params: MapRef & { path: string }) => market.diff(params, params),

    /** Имена встроенных плагинов — что можно поставить. */
    builtinPlugins: () => installPlugin.names(),

    /** Погасить процессы плагинов вместе с платформой. */
    stopPlugins: () => plugins.stopAll(),
  };
}
