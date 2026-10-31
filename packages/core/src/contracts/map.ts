import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeMethod, createBridgeSubscription } from "./bridge.ts";

/** Which map to read: the sidebar may hold several at once. */
export const MapRef = T.Object({
  mapPath: T.String(),
  basePath: T.String(),
  name: T.String(),
});

/**
 * The map is a tree, and typebox cannot describe a recursive shape without ceremony. Params
 * are validated because they cross from the webview; results come from our own host code and
 * are typed on the client instead.
 */
/** Что умеет хост, поднявший сервер — решение 0014: клиент не рисует того, чего нет. */
export const Capabilities = T.Object({
  terminals: T.Boolean(),
  openFile: T.Boolean(),
  ask: T.Boolean(),
  /** Умеет ли хост показать текст без файла на диске — решение 0019. */
  virtualDocs: T.Boolean(),
  /**
   * Умеет ли хост открыть объект отдельным табом — решение 0026. Не умеет — иконок «в табе»
   * нет вовсе: ссылка, которая никуда не ведёт, хуже её отсутствия (0014).
   */
  tabs: T.Boolean(),
});

export const mapBridge = {
  /**
   * Перечитать карту — кнопка рядом со стрелками навигации, как в браузере (решение 0041).
   * Карта у сервера одна и следит за собой сама; кнопка — для того, что вотчер пропустил.
   */
  reloadMap: createBridgeMethod(MapRef, T.Void()),
  /**
   * Объект карты по подписке: свои поля после наследования и подстановок и ближайшие дети без
   * внуков. Модель карты одна — у сервера; клиент её не собирает, а смотрит на неё. Приходит
   * объект и дальше каждое его изменение, одно на пачку; `null` — объекта по адресу нет.
   */
  watchObject: createBridgeSubscription(
    T.Object({ mapPath: T.String(), basePath: T.String(), name: T.String(), address: T.String() }),
    T.Unknown(),
  ),
  /** Предки объекта от корня, без него самого, — для крошек: адрес и имя. */
  watchAncestors: createBridgeSubscription(
    T.Object({ mapPath: T.String(), basePath: T.String(), name: T.String(), address: T.String() }),
    T.Array(T.Object({ address: T.String(), name: T.String() })),
  ),
  getCapabilities: createBridgeMethod(T.Void(), Capabilities),
  /**
   * Открыть объект отдельным табом редактора — решение 0026. Таб всегда показывает объект;
   * `group` говорит, какая вкладка в нём открыта, `metric` — что показана одна метрика во всю
   * ширину, без шапки и соседей.
   */
  openInTab: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      group: T.Optional(T.String()),
      metric: T.Optional(T.String()),
    }),
    T.Void(),
  ),
  /**
   * Что таб показывает сейчас: по нему хост пишет имя вкладки. Таб открывают на одном объекте,
   * а переходами уходят в другой, и имя должно идти следом. Из сайдбара вызов ничего не делает.
   */
  showingInTab: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      metric: T.Optional(T.String()),
    }),
    T.Void(),
  ),
  /**
   * Куда сайдбару перейти: кнопка «к объекту» в файле директивы. Подписка, а не вызов: хост сам
   * заговаривает с сайдбаром только так. Просьба отдаётся один раз — пересозданный сайдбар к
   * объекту снова не прыгает; пока подписчика нет, ждёт последняя. Табу её не шлют: таб хост
   * поднимает сам.
   */
  watchFocus: createBridgeSubscription(
    T.Void(),
    T.Object({ mapPath: T.String(), address: T.String() }),
  ),
  /**
   * Собранный компонент метрики — решение 0037. Подписка, а не вызов: правка компонента или
   * того, что он импортирует, пересобирает его, и ячейка перерисовывается сама.
   */
  watchComponent: createBridgeSubscription(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      metric: T.String(),
    }),
    T.Unknown(),
  ),
  /**
   * Собранная своя форма экшона (`component` в его `config.json`) — тем же сборщиком, что
   * компоненты метрик, и так же пересобирается на правку.
   */
  watchActionForm: createBridgeSubscription(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      action: T.String(),
    }),
    T.Unknown(),
  ),
  /**
   * Собранная раскладка группы — компонент, которому группа отдаёт свои метрики. Собирает тот
   * же сервер, что компоненты метрик, и так же пересобирает на правку. Раскладка ищется по
   * объекту и ключу группы: путь к ней знает модель карты, а не клиент.
   */
  watchLayout: createBridgeSubscription(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      group: T.String(),
    }),
    T.Unknown(),
  ),
};

/** Creating a directive is a host job: it writes a file and opens it for editing. */
export const directiveBridge = {
  createDirective: createBridgeMethod(
    T.Object({ objectPath: T.String() }),
    T.Object({ path: T.String() }),
  ),
  /**
   * Удаление — такая же работа хоста: он спрашивает, точно ли, а файл и состояние прогонов
   * убирает сервер. Отказались от удаления или файла у объекта нет — приходит `deleted: false`.
   */
  deleteDirective: createBridgeMethod(
    T.Object({ objectPath: T.String(), directive: T.String() }),
    T.Object({ deleted: T.Boolean() }),
  ),
};

/**
 * Терминал — сессия агента, и заводится он на объект, а не на директиву: директив у объекта
 * много, этапов у каждой несколько, и всё это греет один контекст — решение 0017.
 *
 * Адресуется сессия идентификатором, а не именем: имя вкладки меняется, пока идёт этап.
 */
export const terminalBridge = {
  openObjectTerminal: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      fresh: T.Optional(T.Boolean()),
    }),
    T.Object({ id: T.String(), name: T.String() }),
  ),
  /**
   * Запустить этап кнопкой: хост отправляет в живую сессию объекта фразу «выполни этап такой-то
   * по директиве такой-то» — то же самое, что человек набрал бы руками (решение 0017). Промпт
   * этапа кнопка не несёт: его агент берёт из MCP сам.
   */
  runStage: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      directive: T.String(),
      stage: T.String(),
    }),
    T.Object({ id: T.String(), name: T.String() }),
  ),
  /** Показать уже открытый терминал: список даёт идентификатор, имя — только для глаз. */
  showTerminal: createBridgeMethod(T.Object({ id: T.String() }), T.Void()),
  /**
   * Показать терминал директивы — тот, что завела кнопка её этапа. Нет такого — ничего: этап
   * могли запустить словами из чужого терминала, и какой он, хост не знает; новый не заводится,
   * для этого есть кнопка этапа.
   */
  showDirectiveTerminal: createBridgeMethod(
    T.Object({ address: T.String(), directive: T.String() }),
    T.Void(),
  ),
  listTerminals: createBridgeMethod(
    T.Object({ address: T.String() }),
    T.Array(T.Object({ id: T.String(), name: T.String() })),
  ),
  closeTerminal: createBridgeMethod(T.Object({ id: T.String() }), T.Void()),
};

export type Capabilities = Static<typeof Capabilities>;

/**
 * Собранный компонент — то, что приходит подпиской `watchComponent`, `watchLayout` и
 * `watchActionForm` (решение 0037). Код — CommonJS: `react` и `@mapward/component` в нём не лежат,
 * их отдаёт клиент, иначе на странице две копии React и хуки ломаются.
 *
 * `errors` вместо кода — сборка не прошла; строки уже с файлом и позицией, клиенту остаётся
 * их показать.
 */
export type ComponentBuild = {
  code?: string;
  /** Css уже ограничен территорией компонента — элементами с меткой `scope` (решение 0048). */
  css?: string;
  /** Метка компонента: клиент ставит её атрибутом `data-mw-component` на клетку и слой окон. */
  scope?: string;
  errors?: string[];
  builtAt: string;
};
