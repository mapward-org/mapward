import {
  confirmQuestion,
  findActionOwner,
  findMetricOwner,
  groupMetrics,
  MAP_ROOT,
  MapEditOp,
  memberOwner,
} from "@mapward/core";
import type { MapAction, MapFile, MapMetric, MapObject } from "@mapward/core";
import { LANGUAGES, section, sections } from "@mapward/docs";
import type { Language } from "@mapward/docs";
import type { MapServer } from "./server.ts";
import { projectDeep } from "../lib/projection.ts";
import { fit } from "../lib/budget.ts";
import type { MapRef } from "../kernel/map-ref.ts";
import { PluginMissing } from "../features/plugins/index.ts";
import { schemaErrors } from "../lib/schema-errors.ts";

/**
 * MCP — ещё один транспорт к тем же юзкейсам, а не вторая модель карты (решения 0009 и 0014).
 * Поэтому здесь нет ни чтения файлов, ни своих правил: только перевод вызовов агента в вызовы
 * сервера.
 *
 * Транспорт приходит снаружи: по stdio его даёт cli, внутри редактора — расширение.
 */
export type McpTransport = {
  onMessage(handler: (message: unknown) => void): () => void;
  send(message: unknown): void;
};

type Request = { jsonrpc: "2.0"; id?: number | string; method: string; params?: unknown };

/**
 * Из какой сборки отвечает сервер — решение 0039. Живой MCP обслуживает собранный бандл, а не
 * исходники, и агент, проверяющий свою правку, иначе не отличит «правка не сработала» от «окно
 * не перезагрузили». Собирает это хост: только он знает, из какого файла загружен.
 *
 * `stale` — файл бандла на диске новее того, что загружено: пересобрали, а окно не перезагрузили.
 */
export type McpBuild = { bundle: string; builtAt?: string; loadedAt: string; stale: boolean };

/**
 * Сведения о сборке для `serveMcp` по файлу бандла. Время сборки — время файла на момент загрузки:
 * вшивать его при сборке значило бы трогать конфиги обоих хостов ради одного числа. Файлы
 * читает хост, поэтому `mtime` приходит снаружи — у сервера своего доступа к диску нет.
 */
export function bundleBuild(
  bundle: string,
  mtime: (path: string) => number | undefined,
  loadedAt = new Date(),
): () => McpBuild {
  const built = mtime(bundle);
  return () => {
    const now = mtime(bundle);
    return {
      bundle,
      ...(built === undefined ? {} : { builtAt: new Date(built).toISOString() }),
      loadedAt: loadedAt.toISOString(),
      stale: built !== undefined && now !== undefined && now > built,
    };
  };
}

const PROTOCOL = "2024-11-05";

/**
 * Объект по адресу и `depth` уровней его детей — читается он, а не карта. Модель догоняет диск
 * вотчером (решение 0041), и агент, который только что записал объект мимо сервера, может
 * спросить о нём раньше, чем вотчер скажет. Поэтому промах по адресу — повод перечитать то, что
 * модель держит, и посмотреть ещё раз, а не сразу «не найден».
 */
async function freshObject(
  server: MapServer,
  ref: MapRef,
  address: string,
  depth = 0,
): Promise<MapObject | undefined> {
  const found = await server.readObject({ ...ref, address, depth });
  if (found) return found;
  await server.reloadMap(ref);
  return server.readObject({ ...ref, address, depth });
}

/** Экшон или метрика по адресу — у объекта, которому они принадлежат: читается только он. */
async function memberOf(
  server: MapServer,
  ref: MapRef,
  address: string,
): Promise<{ action?: MapAction; metric?: MapMetric }> {
  const owner = memberOwner(address);
  const holder = owner === undefined ? undefined : await freshObject(server, ref, owner);
  if (!holder) return {};
  return {
    action: findActionOwner(holder, address)?.action,
    metric: findMetricOwner(holder, address)?.metric,
  };
}

/**
 * Файл объекта: путь нужен тому, кто собирается его открыть или подвинуть, а `owner` говорит,
 * что лежит он у прототипа и править надо там — решение 0016.
 */
const fileOf = (file: MapFile) => ({
  name: file.name,
  path: file.path,
  // Сколько весит: по нему решают, читать файл целиком или хвостом. Хост, не назвавший
  // размера, оставляет поле пустым.
  ...(file.bytes === undefined ? {} : { bytes: file.bytes }),
  ...(file.owner === undefined ? {} : { owner: file.owner }),
});

/**
 * Экшон — решение 0038: именованный ярлык на изменяющий метод плагина с заданными параметрами.
 * Агенту нужны адрес и форма: `inputs`, если написаны, иначе форма — параметры метода из
 * `describe_plugin` без заданных в `params`. Сам конфиг целиком приходит `read_index` по адресу.
 */
const actionOf = (action: MapAction) => ({
  key: action.key,
  address: action.address,
  label: action.config.label ?? action.key,
  ...(action.config.description === undefined ? {} : { description: action.config.description }),
  ...(action.config.inputs === undefined ? {} : { inputs: action.config.inputs }),
  // Текст вопроса — как есть, с `${{ inputs.… }}`: данные формы агент подставит сам, а
  // run_action без `confirmed` вернёт уже заполненный вопрос.
  ...(action.config.confirm ? { confirm: action.config.confirm } : {}),
  ...(action.config.plugin === undefined ? {} : { plugin: action.config.plugin }),
  ...(action.config.method === undefined ? {} : { method: action.config.method }),
  ...(action.config.params === undefined ? {} : { params: action.config.params }),
  configPath: action.configPath,
  ...(action.owner === undefined ? {} : { owner: action.owner }),
  layers: action.layers,
});

/**
 * Адрес следующего слоя конфига. Читается из самого файла, а не из модели: модель держит
 * мердж, и в нём уже не видно, чей это `extends` — решение 0019. Сломанный json не ошибка
 * здесь: сырое чтение обязано отдать то, что лежит, а не проверять его.
 */
function extendsOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as { extends?: unknown }).extends;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Директивы сводкой: на корне их два десятка, и почти все давно прогнаны. Выполненная
 * директива — археология, на старте сессии она не нужна, а имя с путём у каждой стоит
 * полтора килобайта. Нужен весь список — `directives: "all"` (решение 0016).
 */
function digest(files: MapFile[], all: boolean) {
  const counts = { total: files.length, new: 0, running: 0, waiting: 0, done: 0 };
  for (const file of files) {
    if (file.status !== undefined) counts[file.status]++;
  }
  const shown = all ? files : files.filter((file) => file.status !== "done");
  return {
    ...counts,
    files: shown.map((file) => ({
      ...fileOf(file),
      status: file.status,
      // Последний этап: идущий видно с первой секунды, отметку ставит run_directive — решение 0017.
      ...(file.stage === undefined ? {} : { stage: file.stage }),
      // Сколько кругов директива уже прошла: третий Брейншторм и первый читаются по-разному.
      ...(file.runs === undefined ? {} : { runs: file.runs }),
      ...(file.closedAt === undefined ? {} : { closedAt: file.closedAt }),
    })),
  };
}

/** Что из объекта класть в ответ: отбор метрик по ключам и полнота списка директив. */
export type View = {
  metrics?: string[];
  group?: string;
  directives: boolean;
  /**
   * Собирать ли значения. Только когда метрики назвали ключами или вкладкой: значение метрики-
   * компонента — вызов плагина, а вызов будит процесс, и обход дерева без просьбы поднял бы все
   * плагины поддерева.
   */
  values: boolean;
};

/** Сколько ждать запрос для агента, если зовущий не назвал своё: платформа своих сроков не ставит. */
const AGENT_TIMEOUT_MS = 30_000;

/**
 * Что метрика показывает агенту: её запрос для агента — метод плагина. Компонент агент не
 * исполняет, поэтому без запроса у него остаются только методы плагина. У дорогой метрики
 * запрос — `agent.ask`: первым значением приходит сохранённый ответ, а не новый вопрос.
 */
async function agentValue(
  server: MapServer,
  ref: MapRef,
  metric: MapMetric,
  timeout: number,
): Promise<Record<string, unknown>> {
  const agent = metric.config.agent;
  if (!agent) {
    return {
      collected: false,
      hint: "у метрики нет запроса для агента: что она показывает человеку, видно по методам её плагинов — describe_plugin",
    };
  }
  try {
    const data = await server.pluginFirst(
      { ...ref, plugin: agent.plugin, method: agent.method, args: agent.params ?? {} },
      timeout,
    );
    return { collected: true, ok: true, data };
  } catch (error) {
    return {
      collected: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Какие метрики объекта попадают в ответ — решение 0025.
 *
 * Ключи, названные в `metrics`, побеждают всё: агент, назвавший метрику по имени, знает, что
 * просит, даже если она не лежит ни в одной вкладке. Названа группа — приходит она; не названа,
 * а группы у объекта есть — приходят метрики всех вкладок, и только они: метрика вне вкладок
 * не показывается и на экране.
 */
function pickMetrics(object: MapObject, view: View, top: boolean): MapMetric[] {
  if (view.metrics !== undefined) {
    return object.metrics.filter((metric) => view.metrics?.includes(metric.key));
  }
  // Вкладка спрашивается у названного объекта, а не у всего поддерева: одноимённой группы у
  // ребёнка может не быть вовсе, и отбор по чужому ключу отдал бы случайный набор.
  if (top && view.group !== undefined) return groupMetrics(object, view.group);
  if (object.metricGroups.length === 0) return object.metrics;

  const named = new Set(object.metricGroups.flatMap((group) => group.metrics));
  return object.metrics.filter((metric) => named.has(metric.key));
}

/**
 * Объект в том виде, в каком его видит человек — решение 0009: поля после мерджа и
 * подстановок, метрики со значениями и конфигом (там же `exclude` у детей), раскладки, по
 * которым они разложены на экране.
 *
 * `depth` уводит вглубь по тем же правилам: дети приходят такими же объектами, а не именами.
 * Это не второй способ читать карту, а тот же ответ, только глубже — решение 0016.
 */
async function describe(
  server: MapServer,
  ref: MapRef,
  object: MapObject,
  depth: number,
  view: View,
  top = true,
): Promise<Record<string, unknown>> {
  // Отбор идёт до сбора: метрика, которую не просили, не должна и считаться — иначе `depth`
  // поднимает процессы по всему поддереву ради значений, которые тут же выбрасываются.
  const wanted = pickMetrics(object, view, top);
  const values = view.values
    ? Object.fromEntries(
        await Promise.all(
          wanted.map(
            async (metric) =>
              [metric.address, await agentValue(server, ref, metric, AGENT_TIMEOUT_MS)] as const,
          ),
        ),
      )
    : {};
  // Вверх по дереву — решение 0016: дети у объекта уже есть, а родителя без этого не видно,
  // и агент не мог уйти к соседу иначе как обходом от корня.
  //
  // Раскрытому ребёнку цепочка не нужна: он лежит внутри своего родителя, и повторять её у
  // каждого значит платить за одно и то же столько раз, сколько в ответе объектов.
  //
  // Предки читаются по папкам на пути, а не обходом карты от корня.
  const parents = top
    ? (await server.readAncestors({ ...ref, address: object.address }))
        .toReversed()
        .map((ancestor) => ({ address: ancestor.address, name: ancestor.name }))
    : undefined;

  return {
    address: object.address,
    name: object.name,
    prototypeName: object.prototypeName,
    path: object.path,
    props: object.props,
    // Из каких `_index.json` собран объект. Ссылками: конфиг слоя читается `read_index`
    // по названному адресу, а вложенный он повторил бы самое тяжёлое в ответе (решение 0019).
    layers: object.layers,
    /**
     * Вкладки объекта — решение 0025. Перечень, а не значения: он отвечает, что можно выбрать
     * параметром `group`, и объясняет, почему метрик в ответе меньше, чем лежит в `_metrics`.
     * У объекта без вкладок поля нет вовсе, и это значит «показываются все метрики».
     */
    ...(object.metricGroups.length === 0
      ? {}
      : {
          groups: object.metricGroups.map((group) => ({
            key: group.key,
            ...(group.label === undefined ? {} : { label: group.label }),
            ...(group.description === undefined ? {} : { description: group.description }),
            metrics: group.metrics,
            // Раскладка — компонент: агенту хватает пути, чтобы прочесть его, когда нужно.
            ...(group.layout === undefined ? {} : { layout: group.layout }),
            // Превью объекта — это его вкладка: агент выбирает её тем же `group`.
            ...(group.defaultPreview === true ? { defaultPreview: true } : {}),
          })),
        }),
    metrics: wanted.map((metric) => ({
      key: metric.key,
      address: metric.address,
      label: metric.config.label ?? metric.key,
      // Метрика — компонент, её значение для агента — запрос к плагину.
      ...(metric.config.agent ? { agent: metric.config.agent } : {}),
      configPath: metric.configPath,
      // Заведена не здесь, а у прототипа: инвариант 0015 спрашивает именно это.
      ...(metric.owner === undefined ? {} : { owner: metric.owner }),
      /** Файлы, из которых собран конфиг: первый — `configPath`, дальше прототип и `extends`. */
      layers: metric.layers,
      // Конфиг целиком: в нём видно и коллекторы, и `exclude` у карты детей.
      config: metric.config,
      ...(view.values ? { value: values[metric.address] } : {}),
    })),
    // Значений нет, потому что не просили, а не потому что пусто: так и говорится.
    ...(top && !view.values && wanted.length > 0
      ? {
          metricsHint:
            "значения метрик не собирались — назови их в metrics или вкладкой в group: значение бывает вызовом плагина, и без просьбы его не будят",
        }
      : {}),
    directives: digest(object.directives, view.directives),
    actions: object.actions.map(actionOf),
    /**
     * Этапы, действующие на объекте: звать их теперь по имени, и узнать имя больше неоткуда —
     * по файлам не видно, что приехало от прототипа (решение 0017).
     *
     * Только у верхнего объекта ответа, по тому же доводу, что и `parents`: раскрытый ребёнок
     * лежит внутри родителя, и повторять у каждого пять этапов с путями значит платить за одно и
     * то же столько раз, сколько в ответе объектов. Понадобились у ребёнка — он спрашивается
     * своим вызовом, и там он верхний.
     */
    ...(top
      ? {
          workflow: object.workflow.map((stage) => ({
            name: stage.name,
            order: stage.order,
            ...(stage.marksDone ? { marksDone: true } : {}),
            ...(stage.path === "" ? { builtin: true } : { path: stage.path }),
            ...(stage.owner === undefined ? {} : { owner: stage.owner }),
          })),
        }
      : {}),
    /** От ближайшего родителя к корню: по ним поднимаются и уходят к соседям через их детей. */
    ...(parents === undefined ? {} : { parents }),
    children:
      depth > 0
        ? await Promise.all(
            object.children.map((child) => describe(server, ref, child, depth - 1, view, false)),
          )
        : object.children.map((child) => ({ address: child.address, name: child.name })),
    map: ref.name,
  };
}

const TOOLS = [
  {
    name: "list_maps",
    description:
      "Карты, которые отдаёт этот сервер. Имя карты указывается в остальных вызовах. " +
      "Поле build — из какой сборки отвечает сервер; stale: true — пересобрали, а окно не перезагрузили.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_object",
    description:
      "Объект карты так, как его видит человек: поля после наследования и подстановок, список метрик, директив, экшонов, родителей и детей. " +
      "layers — файлы, из которых собран мердж, у объекта и у каждой метрики: адрес и путь, от своего к дальнему прототипу. Сам конфиг слоя берётся read_index по этому адресу. " +
      "Весь контекст разом: depth уводит вглубь по детям, metrics отбирает метрики по ключам, fields — поля в ответе. " +
      "У объекта с вкладками (поле groups) метрики разложены по группам: group отбирает одну из них, " +
      "без него приходит перечень метрик всех вкладок без значений, а не названная ни в одной не приходит никогда — её не показывают и человеку. " +
      "Значения собираются только у метрик, названных в metrics или вкладкой в group. Значение метрики — её запрос для агента к плагину (поле agent): у дорогой метрики это agent.ask — сохранённый ответ; спросить заново — call_plugin с методом refresh и теми же параметрами. " +
      'Начинай с обзора — { depth: 2, metrics: [], fields: ["address", "name", "prototypeName", "path", "props", "directives"] } — ' +
      'и только потом зови нужные: { address, metrics: ["files"] }. Названная одна метрика бюджетом не режется. ' +
      "Почти весь вес ответа сидит в metrics.value, поэтому metrics важнее fields. " +
      "workflow приходит только у верхнего объекта ответа: у раскрытых детей он тот же самый.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес; без него корень" },
        map: { type: "string", description: "имя карты; без него первая" },
        metrics: {
          type: "array",
          items: { type: "string" },
          description:
            'какие метрики включить со значениями, по ключам: ["files", "architecture"]. Без параметра приходит перечень метрик без значений — значение бывает вызовом плагина, и без просьбы плагины не будятся. Пустой список — ни одной метрики, и это правильный обзорный вызов',
        },
        group: {
          type: "string",
          description:
            'ключ вкладки из поля groups: "тяжёлое". Приходят только её метрики — так у объекта спрашивают набор целиком, не перечисляя ключи. Вместе с metrics не нужен: перечисленные поимённо метрики приходят в любом случае',
        },
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            'какие поля вернуть, точечными путями: "address", "props", "metrics.value". Применяется на каждом уровне глубины, поэтому children перечислять не надо — дети приходят с теми же полями. Без параметра приходит всё, включая metrics.config, а он нужен, только когда метрику правят',
        },
        directives: {
          type: "string",
          enum: ["pending", "all"],
          description:
            'по умолчанию "pending" — счётчики и только непрогнанные с изменившимися; "all" добавляет выполненные, которых на старых объектах десятки',
        },
        budget: {
          type: "number",
          description:
            "ориентир по размеру ответа в байтах json: пока он превышен, самые тяжёлые значения и конфиги метрик заменяются на { truncated, bytes } — ответ не пропадает целиком. Перечень метрик и поля объектов не режутся, поэтому вызов по всей карте останется большим и с маркерами; чтобы этого не было, отбирай metrics. Одна метрика, названная в metrics, не режется вовсе. По умолчанию 24000, ноль снимает предел",
        },
        depth: {
          type: "number",
          description:
            "насколько глубоко раскрыть детей: 0 (по умолчанию) — именами, 1 и больше — такими же объектами",
        },
      },
    },
  },
  {
    name: "read_index",
    description:
      "Сырое содержимое папки по адресу, как оно написано на диске — до наследования и подстановок: " +
      "`_index.json` объекта и `config.json`, если он там лежит; любое из двух может отсутствовать. " +
      "Адресом метрики (он приходит в read_object рядом с ключом) отдаётся её собственный конфиг " +
      "и, полем extends, адрес следующего слоя — цепочка читается по одному слою за вызов. " +
      "Адресом экшона — его config.json так же, слоями. " +
      "С file — текст директивы этого объекта по имени из read_object, включая доставшиеся от прототипа; " +
      "с tail — только его хвост. " +
      "С stage — текст этапа воркфлоу, не запуская его и не отмечая прогон.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "mapward:// адрес объекта, метрики или экшона; без него корень. Адреса метрик и экшонов — те, что в read_object",
        },
        map: { type: "string", description: "имя карты; без него первая" },
        file: {
          type: "string",
          description:
            'имя директивы объекта, как в ответе read_object: "2026-09-19-2335-name.md". Без него приходит _index.json',
        },
        tail: {
          type: "number",
          description:
            "только последние N строк файла — директива дописывается снизу, и последний круг вопросов с ответами лежит в конце. Файл короче — приходит целиком; сколько в нём строк всего, говорит поле lines. Только вместе с file",
        },
        stage: {
          type: "string",
          description:
            'имя этапа из workflow объекта: "Проверка". Приходит его текст, порядок и marksDone — читать этап можно, не запуская его. Запуск с отметкой о прогоне — run_directive',
        },
      },
    },
  },
  {
    name: "read_docs",
    description:
      "Документация самого mapward: модель, `_index.json`, метрики, адресация, директивы, MCP. " +
      "Без section приходит оглавление, с section — раздел целиком. " +
      "Зови вместо того, чтобы выяснять устройство карты по исходникам: у установленного mapward их нет.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description: "имя раздела из оглавления; без него — само оглавление",
        },
        language: {
          type: "string",
          enum: [...LANGUAGES],
          description: 'язык документации; пока только "ru", он же по умолчанию',
        },
      },
    },
  },
  {
    name: "run_directive",
    description:
      "Взять директиву в работу: вернуть промпт этапа и отметить, что прогон начался. " +
      "Кнопок у директивы нет — этим вызовом она и выполняется. " +
      "Какие этапы есть у объекта, видно в read_object, поле workflow; без stage берётся первый. " +
      "Вместе с промптом приходит promptHash: на следующем круге передай его в known, и неизменившийся промпт не приедет заново. " +
      "Поле build говорит, из какой сборки отвечает сервер; stale: true — пересобрали, а окно не перезагрузили.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес объекта директивы" },
        directive: {
          type: "string",
          description: 'имя файла директивы, как в read_object: "2026-09-19-2335-name.md"',
        },
        stage: {
          type: "string",
          description: "имя этапа из workflow объекта; без него — первый по порядку",
        },
        known: {
          type: "string",
          description:
            "promptHash из прошлого ответа run_directive. Совпал — промпт не повторяется, приходит unchanged: true, а прогон отмечается как обычно. Промпта в контексте нет — не передавай",
        },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["address", "directive"],
    },
  },
  {
    name: "finish_directive",
    description:
      "Отметить, что этап закончен. Этап, которому это поручено (marksDone), помечает директиву выполненной: " +
      "статус, этап и счётчик кругов сервер пишет во frontmatter директивы сам, руками его не правят. " +
      "С reply сервер сам дописывает реплику в конец файла директивы: ставит пустую строку перед ней и ничего выше не трогает.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес объекта директивы" },
        directive: { type: "string", description: "имя файла директивы" },
        stage: { type: "string", description: "имя этапа; без него — первый по порядку" },
        reply: {
          type: "string",
          description:
            'текст реплики в тред, как есть — с "> [AI]" и цитатой. Дописывается в конец директивы до записи состояния, поэтому попадает и в копию выполненной',
        },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["address", "directive"],
    },
  },
  {
    name: "run_action",
    description:
      "Запустить экшон объекта — то же, что кнопка на карте. Экшон — ярлык на изменяющий метод плагина (plugin, method, params): платформа зовёт метод и записывает вызов, ход и итог в историю — прогон виден в объекте на экране прогонов. " +
      "Экшоны приходят в read_object, поле actions. Поля формы — inputs экшона, а без них — параметры метода из describe_plugin, кроме заданных в params. Поля проверяет сервер: не хватает обязательного — прогона нет, в ответе errors. " +
      "По умолчанию вызов ждёт конца и отдаёт прогон целиком: шаги, логи, вывод, итог (result). С wait: false отдаёт номер сразу, итог — read_run. " +
      "Метод можно позвать и напрямую, call_plugin, — тогда истории нет. Что экшон сделал, видно в метриках объекта: они подписаны на свои плагины и обновятся сами.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес экшона, как в read_object" },
        inputs: {
          type: "object",
          description:
            "значения полей формы по именам; непереданное берёт умолчание. Заданное экшоном в params формой не перебивается",
        },
        wait: {
          type: "boolean",
          description:
            "по умолчанию true — дождаться конца. false — вернуть номер прогона сразу, прогон идёт у сервера",
        },
        confirmed: {
          type: "boolean",
          description:
            "человек ответил «да» на вопрос экшона (поле confirm). Без него экшон с вопросом не запускается, а в ответ приходит сам вопрос",
        },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["address"],
    },
  },
  {
    name: "describe_plugin",
    description:
      "Самоописание плагина: его методы, читающий или изменяющий, JSON-схемы параметров и значений, и шаблоны метрик (templates: компонент, схема params, запрос для агента) — по ним метрику пишут короткой формой в edit_map set. " +
      "Плагин — папка с кодом, путь от корня карты или абсолютный; у метрики-компонента он стоит в agent.plugin. " +
      "Процесс плагина при этом поднимается, как на вызов. Плагина по пути нет — в ответе перечень встроенных: их ставит add_plugin.",
    inputSchema: {
      type: "object",
      properties: {
        plugin: {
          type: "string",
          description: "путь к папке плагина: от корня карты или абсолютный",
        },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["plugin"],
    },
  },
  {
    name: "check_plugin",
    description:
      "Работает ли плагин — после правки его кода: сборка (ошибки — файл:строка:колонка), процесс и рукопожатие, " +
      "самоописание (методы и читаются ли их схемы), и метрики карты, которые на него ссылаются (agent.plugin — он или компонент в его папке): " +
      "компонент собирается, запрос для агента зовётся пробно. Ответ — шаги со статусом ok/fail/skip и строками; ok — всё прошло. " +
      "То же, что mapward plugin check в терминале.",
    inputSchema: {
      type: "object",
      properties: {
        plugin: {
          type: "string",
          description: "путь к папке плагина: от корня карты или абсолютный",
        },
        timeout: {
          type: "number",
          description: "сколько ждать каждый пробный запрос для агента, мс; по умолчанию 30000",
        },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["plugin"],
    },
  },
  {
    name: "clear_build_cache",
    description:
      "Стереть сохранённые сборки компонентов карты — метрик, раскладок, своих форм экшонов: файлы .mapward/builds/ и память сервера. " +
      "Сборка помнит все ответы файлов сборщику (прочитанное, промахи, пакеты в node_modules) и переиспользуется, только если они те же, — " +
      "так что звать это нужно, лишь когда компонент явно показывает старое. То, на что сейчас смотрят, собирается заново. " +
      "Ответ — { removed: сколько файлов стёрто, rebuilt: сколько сборок пересобирается }.",
    inputSchema: {
      type: "object",
      properties: {
        map: { type: "string", description: "имя карты; без него первая" },
      },
    },
  },
  {
    name: "add_plugin",
    description:
      "Поставить встроенный плагин в карту: его исходники копируются в _plugins/<имя> (или в названную папку внутри карты) и дальше это код проекта — его можно править. " +
      "Существующую папку mapward не перезаписывает никогда: она есть — отказ. Скопированный плагин уже доверен. " +
      "Есть у плагина package.json с dependencies — они ставятся в его папку (npm install --omit=dev); не поставились (нет сети) — отказ с командой, копия при этом остаётся. " +
      "Встроенный, которого в _plugins/<имя> ещё нет, доставляется и сам, на первый вызов.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "имя встроенного плагина: files, navigation, objects-map, …",
        },
        path: {
          type: "string",
          description:
            "папка от корня карты или абсолютная внутри неё; по умолчанию _plugins/<имя>",
        },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["name"],
    },
  },
  {
    name: "market_search",
    description:
      "Маркетплейс mapward: найти в реестре плагины и куски карты (прототипы с метриками, экшонами, этапами директив), которые выложили другие. " +
      "Реестр — публичный репозиторий mapward-org/market на GitHub, каждая строка — репозиторий автора и ветка. " +
      "Ищет словами по имени и описанию; без query — весь индекс. Дальше — market_read: исходники до установки.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "слова поиска; без них — всё" },
        kind: {
          type: "string",
          enum: ["plugin", "map"],
          description: "plugin — плагины, map — куски карты; без него оба индекса",
        },
      },
    },
  },
  {
    name: "market_read",
    description:
      "Прочитать то, что лежит в реестре, не ставя в карту: без path — дерево файлов, README и коммит ветки; с path — текст файла. " +
      "Это проверка до установки: за безопасность реестр не отвечает, код плагина и команды в метриках куска читают здесь. " +
      "commit — прочитать на записанном коммите, как он был при установке.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "имя из market_search" },
        kind: {
          type: "string",
          enum: ["plugin", "map"],
          description: "если имя есть в обоих индексах",
        },
        path: { type: "string", description: "файл от корня репозитория" },
        commit: { type: "string", description: "коммит вместо ветки" },
      },
      required: ["name"],
    },
  },
  {
    name: "market_add",
    description:
      "Поставить из реестра копией — дальше это код проекта, как встроенный плагин. Плагин копируется в _plugins/<имя> (или path), " +
      "его зависимости ставит npm; доверенным он не становится — до первого запуска редактор спросит человека «Доверять?». " +
      "Кусок карты ложится под parent (без него — корень) одной пачкой правки карты: адреса внутри переписываются на новое место, " +
      "отмена — undo_edit по id из ответа; плагины из его market.json ставятся первыми. Занятое место — отказ. " +
      "Рядом остаётся .market.json — откуда и с какого коммита; по нему market_diff.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "имя из market_search" },
        kind: {
          type: "string",
          enum: ["plugin", "map"],
          description: "если имя есть в обоих индексах",
        },
        path: {
          type: "string",
          description: "плагину — папка от корня карты; по умолчанию _plugins/<имя>",
        },
        parent: {
          type: "string",
          description: "куску карты — адрес родителя; по умолчанию mapward://",
        },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["name"],
    },
  },
  {
    name: "market_diff",
    description:
      "Сравнить поставленное из маркетплейса с веткой автора: по .market.json в папке — записанный коммит, коммит ветки сейчас (latest) " +
      "и файлы, изменившиеся у автора (author) или в карте (local). Обновления командой нет: прочитай изменения market_read " +
      "(commit — как было, без него — как стало) и перенеси их поверх правок проекта.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "папка плагина или объекта куска: от корня карты или абсолютная",
        },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["path"],
    },
  },
  {
    name: "call_plugin",
    description:
      "Вызвать метод плагина — так же, как его зовёт компонент метрики. Метод отвечает потоком: " +
      'по умолчанию приходит первое значение; wait: "complete" ждёт конца и отдаёт все значения — так ждут долгий изменяющий метод. ' +
      "Изменяющие методы открыты агенту, отменять сделанное — забота плагина.",
    inputSchema: {
      type: "object",
      properties: {
        plugin: {
          type: "string",
          description: "путь к папке плагина: от корня карты или абсолютный",
        },
        method: { type: "string", description: "имя метода из describe_plugin" },
        args: { type: "object", description: "аргументы метода по его схеме" },
        wait: {
          type: "string",
          enum: ["first", "complete"],
          description:
            'по умолчанию "first" — первое значение; "complete" — все значения до конца потока',
        },
        timeout: { type: "number", description: "мс ожидания; по умолчанию 30000" },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["plugin", "method"],
    },
  },
  {
    name: "read_run",
    description:
      "Прогон экшона по номеру из run_action: статус, шаги, их логи и вывод, итог метода (result). Идущий прогон отдаётся как есть, не дожидаясь конца.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "номер прогона из run_action" },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_map",
    description:
      "Написать карту методами, не ходя в файлы, — пачкой операций; тот же набор, что у интерфейса и у плагинов (ctx.editMap). " +
      "Свои поля по адресу: get (как написаны, без наследования: { content, version }), set (полная замена с проверкой схемой, version — защита от записи поверх чужой правки), delete. " +
      'Адрес — объект (_index.json), метрика (…/_metrics/<ключ>, её config.json), экшон (…/_actions/<ключ>), слой общей метрики (папка с config.json без _index.json; новый — set с kind: "layer"), этап (…/_directives.workflow/<имя>: { name, order, marksDone, text }). ' +
      "Метрику можно писать шаблоном плагина: { label?, plugin, template, params } — шаблоны в describe_plugin; платформа развернёт в component и agent и проверит params. " +
      "Несуществующие метрику, экшон, этап set создаёт; set индекса по адресу полки делает её объектом, delete с keepChildren — объект полкой. " +
      "Структура: create (у родителя: content — _index.json целиком, folder — имя папки), move, setFolder (и для полок), copy. Папки неявные: create и writeFile их создают, опустевшая после delete/move папка уходит. " +
      "Сырые файлы: readFile, writeFile, removeFile — пути внутри карты, кроме .mapward/. " +
      "check — собрать компонент метрики (ошибки с файлом:строкой:столбцом) и спросить её запрос для агента, метрики групп объекта (и унаследованных) и его раскладки, форму экшона, папку плагина; installDeps — зависимости своего плагина. " +
      "Операции идут по очереди, каждая — по карте, где уже есть сделанное предыдущими; отказ любой откатывает всю пачку, ошибки полей — в errors путём до поля. " +
      "Перенос сам переписывает адрес везде, где он стоит строкой в _index.json и config.json карты, тексты директив не трогает. " +
      "В ответе results — ответ каждой операции по порядку, id пачки — по нему undo_edit; created — новые адреса, moves — переезды { from, to }. Стек отмены держи сам. " +
      "Холст (позиции, ссылки, стрелки на вьюхе) правит плагин objects-map — call_plugin, метод edit.",
    inputSchema: {
      type: "object",
      properties: {
        ops: { type: "array", items: MapEditOp, description: "операции пачки, по порядку" },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["ops"],
    },
  },
  {
    name: "undo_edit",
    description:
      "Отменить пачку edit_map по её id. Файлы, которые с тех пор поменяли мимо неё, не затираются: отказ с их перечнем. " +
      "Пачки живут в памяти сервера — после его перезапуска откатывают git.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id пачки из ответа edit_map" },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["id"],
    },
  },
  {
    name: "redo_edit",
    description: "Повторить пачку, отменённую undo_edit, — с той же проверкой файлов.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id пачки" },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["id"],
    },
  },
] as const;

/** Списки строк приходят как есть; всё остальное считается «не назвали». */
const names = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : undefined;

/**
 * Сколько ответ вправе весить. Умолчание есть, потому что вызов без него однажды приезжает с
 * деревом требований внутри и пропадает целиком — решение 0016.
 */
const DEFAULT_BUDGET = 24_000;

const budget = (args: Record<string, unknown>): number =>
  typeof args.budget === "number" ? args.budget : DEFAULT_BUDGET;

const view = (args: Record<string, unknown>): View => ({
  metrics: names(args.metrics),
  ...(typeof args.group === "string" ? { group: args.group } : {}),
  directives: args.directives === "all",
  values: (names(args.metrics)?.length ?? 0) > 0 || typeof args.group === "string",
});

/** Вид из реестра, если его назвали: `plugin` или `map`; другое — как не названный. */
const marketKind = (kind: unknown): { kind?: "plugin" | "map" } =>
  kind === "plugin" || kind === "map" ? { kind } : {};

/** Ответ инструмента: агент читает json как текст — так устроен протокол. */
const text = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/**
 * Поднимает MCP над картами воркспейса. Карт бывает несколько, а сервер один — поэтому карта
 * называется в каждом обращении, как и требует решение 0009.
 *
 * Возвращает функцию остановки.
 */
export function serveMcp(
  server: MapServer,
  maps: MapRef[],
  transport: McpTransport,
  build?: () => McpBuild,
): () => void {
  // Карт единицы, и параметр необязателен — поэтому ошибка сразу называет их все: иначе агент
  // тратит вызов `list_maps` на то, что помещается в одну строку.
  const mapOf = (name: unknown): MapRef => {
    const found = typeof name === "string" ? maps.find((map) => map.name === name) : maps[0];
    if (found) return found;
    const known = maps.map((map) => `«${map.name}»`).join(", ");
    throw new Error(
      known.length > 0
        ? `Карта ${String(name)} не найдена. Сервер отдаёт: ${known}. Без параметра берётся первая.`
        : `Карта ${String(name)} не найдена: сервер не отдаёт ни одной карты.`,
    );
  };

  const reply = (id: Request["id"], result: unknown) =>
    transport.send({ jsonrpc: "2.0", id, result });

  const fail = (id: Request["id"], message: string) =>
    transport.send({ jsonrpc: "2.0", id, error: { code: -32_000, message } });

  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Неизвестный параметр — отказ, а не молчание (решение 0039). Проглоченный параметр
    // выглядит принятым: агент на старой сборке зовёт новый параметр, получает прежний ответ и
    // уверенно заключает, что правка не сработала.
    const tool = TOOLS.find((entry) => entry.name === name);
    if (tool) {
      const known = Object.keys(tool.inputSchema.properties);
      const unknown = Object.keys(args).filter((key) => !known.includes(key));
      if (unknown.length > 0) {
        throw new Error(
          `У ${name} нет параметра ${unknown.join(", ")}. Есть: ${known.join(", ") || "никаких"}.` +
            (build?.().stale ? " Сервер отвечает из устаревшей сборки — перезагрузи окно." : ""),
        );
      }
    }

    if (name === "list_maps") {
      const listed = maps.map((entry) => ({ name: entry.name, mapPath: entry.mapPath }));
      return text(build ? { maps: listed, build: build() } : listed);
    }

    // Доки — про инструмент, а не про карту, поэтому имя карты здесь ни при чём.
    if (name === "read_docs") {
      const language = LANGUAGES.find((known) => known === args.language) as Language | undefined;
      const wanted = typeof args.section === "string" ? args.section : undefined;
      if (wanted === undefined) {
        return text({ language: language ?? LANGUAGES[0], sections: sections(language) });
      }
      const found = section(wanted, language);
      if (!found) {
        const known = sections(language)
          .map((entry) => entry.name)
          .join(", ");
        throw new Error(`Раздела ${wanted} нет. Есть: ${known}.`);
      }
      return text(found);
    }

    const ref = mapOf(args.map);

    if (name === "read_object") {
      const address = typeof args.address === "string" ? args.address : undefined;
      // Поддерево — от названного объекта и на глубину ответа: дети последнего уровня приходят
      // именами, поэтому читается на уровень глубже, чем `depth`. Корень — только если не назвали.
      const depth = typeof args.depth === "number" && args.depth > 0 ? Math.floor(args.depth) : 0;
      const object = await freshObject(server, ref, address ?? MAP_ROOT, depth + 1);
      if (!object) throw new Error(`Объект ${String(address)} не найден`);
      // `metrics: []` выключает метрики целиком, а `fields: ["metrics.key"]` спрашивает про
      // них же — вместе это всегда пустой список, который читается как «метрик у объекта нет».
      // Неправда дороже отказа, поэтому здесь отказ.
      const picked = names(args.metrics);
      const asksMetrics = names(args.fields)?.some(
        (path) => path === "metrics" || path.startsWith("metrics."),
      );
      if (picked?.length === 0 && asksMetrics === true) {
        throw new Error(
          "metrics: [] выключает метрики, а fields просит их поля — вместе всегда пусто. " +
            'Нужны ключи без значений — убери metrics и оставь fields: ["metrics.key"]: ' +
            "перечень приходит без сбора. Нужны конкретные метрики — назови их в metrics.",
        );
      }

      // Вкладка называется по ключу, и промахнуться по нему легко. Молчаливый откат на первую
      // группу отдал бы чужие метрики под видом заказанных, поэтому здесь отказ с перечнем.
      const group = typeof args.group === "string" ? args.group : undefined;
      if (group !== undefined && !object.metricGroups.some((entry) => entry.key === group)) {
        const known = object.metricGroups.map((entry) => `«${entry.key}»`).join(", ");
        throw new Error(
          known.length > 0
            ? `У объекта нет вкладки ${group}. Есть: ${known}.`
            : `У объекта нет вкладок: метрики у него не разложены по группам, зови без group.`,
        );
      }

      const described = await describe(server, ref, object, depth, view(args));
      const answer = projectDeep(described, names(args.fields));
      // Одна метрика, названная по имени, не режется. Отбор и бюджет иначе спорят: агент
      // делает ровно то, что велит дока — зовёт метрику поимённо, — и получает маркер вместо
      // значения, за которым звал. Отказаться от него нечем: ноль в `budget` снимает предел
      // и на соседних вызовах тоже.
      return text(picked?.length === 1 ? answer : fit(answer, budget(args)));
    }

    if (name === "read_index") {
      const address = typeof args.address === "string" ? args.address : undefined;
      // Адрес метрики или экшона объектом не бывает: их ищут у владельца, не перечитывая карту
      // ради промаха по объекту.
      const member = address === undefined ? undefined : memberOwner(address);
      const object =
        member === undefined ? await freshObject(server, ref, address ?? MAP_ROOT) : undefined;

      // `_metrics` — служебная папка, объектом она не ищется, но у метрики есть собственный
      // адрес, и приходит он в ответе рядом с ключом. Поэтому сырой вид метрики спрашивается
      // тем же инструментом, а не своим параметром — решение 0019.
      if (!object) {
        // Экшон читается так же, как метрика: собственный конфиг и адрес следующего слоя.
        const { action, metric } = address ? await memberOf(server, ref, address) : {};
        if (action) {
          if (typeof args.file === "string" || typeof args.stage === "string") {
            throw new Error("У экшона нет файлов и этапов: file и stage спрашивают у объекта.");
          }
          const raw = await server.readMapFile(action.configPath);
          const next = extendsOf(raw);
          return text({
            address: action.address,
            key: action.key,
            configPath: action.configPath,
            ...(action.owner === undefined ? {} : { owner: action.owner }),
            config: raw ?? null,
            ...(next === undefined ? {} : { extends: next }),
          });
        }

        if (!metric) throw new Error(`Объект ${String(address)} не найден`);
        if (typeof args.file === "string" || typeof args.stage === "string") {
          throw new Error(
            "У метрики нет директив, экшонов и этапов: file и stage спрашивают у объекта.",
          );
        }

        const raw = await server.readMapFile(metric.configPath);
        const next = extendsOf(raw);
        return text({
          address: metric.address,
          key: metric.key,
          configPath: metric.configPath,
          // Конфиг лежит у прототипа: править его надо там, и по ответу это видно.
          ...(metric.owner === undefined ? {} : { owner: metric.owner }),
          config: raw ?? null,
          // Следующий слой называется адресом, а не вкладывается значением: конфиги — самое
          // тяжёлое, что есть в ответе (0016), и цепочка повторила бы их целиком.
          ...(next === undefined ? {} : { extends: next }),
        });
      }

      if (typeof args.file === "string" && typeof args.stage === "string") {
        throw new Error("file и stage спрашиваются по отдельности: это разные файлы.");
      }

      // Текст этапа без его запуска: запуск ставит отметку о прогоне, и читать соседний этап
      // им нельзя. У дефолтного этапа файла нет вовсе, и с диска он не достаётся никак.
      if (typeof args.stage === "string") {
        return text(await server.readStage({ ...ref, address: object.address, stage: args.stage }));
      }

      // Файл берётся из модели, а не склейкой пути: так открывается и унаследованный от
      // прототипа, и никакое имя не уводит читать что попало мимо карты.
      if (typeof args.file === "string") {
        const wanted = args.file;
        const found = object.directives.find((file) => file.name === wanted);
        if (!found) {
          const known = object.directives.map((f) => f.name).join(", ");
          throw new Error(`У объекта нет файла ${wanted}. Есть: ${known || "ни одного"}.`);
        }
        const body = await server.readMapFile(found.path);
        const head = { ...fileOf(found), status: found.status };

        // Хвост вместо всего файла: многоэтапная директива дописывается снизу, и последний
        // круг вопросов с ответами — это последние строки. Файл короче запрошенного — он
        // и приходит целиком: обрезать нечего, а `lines` говорит, что это весь текст.
        const tail = typeof args.tail === "number" ? Math.floor(args.tail) : undefined;
        if (tail !== undefined && tail > 0 && body !== undefined) {
          const lines = body.split("\n");
          return text({
            ...head,
            lines: lines.length,
            ...(lines.length > tail ? { tail } : {}),
            text: lines.slice(-tail).join("\n"),
          });
        }

        return text({ ...head, text: body ?? null });
      }

      // Что в папке действительно лежит, то и отдаётся: у общих метрик это `config.json`
      // вместо `_index.json`, и пустой ответ по существующему адресу выглядел бы отсутствием
      // данных, а не «смотри в соседнее поле».
      const raw = await server.readIndexFile(object.path);
      const config = await server.readMapFile(`${object.path}/config.json`);
      return text({
        address: object.address,
        path: object.path,
        index: raw ?? null,
        config: config ?? null,
      });
    }

    if (name === "run_directive" || name === "finish_directive") {
      const params = {
        ...ref,
        address: String(args.address ?? ""),
        directive: String(args.directive ?? ""),
        ...(typeof args.stage === "string" ? { stage: args.stage } : {}),
      };
      if (name === "finish_directive") {
        return text(
          await server.finishDirective({
            ...params,
            ...(typeof args.reply === "string" ? { reply: args.reply } : {}),
          }),
        );
      }
      const started = await server.runDirective({
        ...params,
        ...(typeof args.known === "string" ? { known: args.known } : {}),
      });
      // Сборка — в каждом прогоне: этап начинают с него, а до list_maps агент доходит не всегда.
      return text(build ? { ...started, build: build() } : started);
    }

    if (name === "run_action") {
      const address = String(args.address ?? "");
      const given =
        typeof args.inputs === "object" && args.inputs !== null
          ? (args.inputs as Record<string, unknown>)
          : {};
      // Вопрос перед запуском человек видит окном, агент — ответом: без явного «да» прогона нет.
      if (args.confirmed !== true) {
        const { action } = await memberOf(server, ref, address);
        const question = action && confirmQuestion(action.config, given);
        if (question !== undefined) {
          return text({
            confirm: question,
            hint: "Экшон просит подтверждения, прогона нет. Спроси человека и, если он согласен, позови run_action снова с confirmed: true.",
          });
        }
      }
      const started = await server.runAction({
        ...ref,
        action: address,
        inputs: given,
        source: "mcp",
      });
      if (started.errors) {
        const lines = Object.entries(started.errors).map(([field, why]) => `${field}: ${why}`);
        throw new Error(`Поля формы не прошли, прогона нет. ${lines.join("; ")}`);
      }
      const id = String(started.id);
      if (args.wait === false) return text({ id, status: "running" });
      return text(await server.waitRun({ mapPath: ref.mapPath, id }));
    }

    if (name === "describe_plugin" || name === "call_plugin" || name === "check_plugin") {
      const given = String(args.plugin ?? "").replaceAll("\\", "/");
      // Путь от корня карты — так его пишет агент; абсолютный — как он стоит в agent.plugin.
      const plugin =
        given.startsWith("/") || /^[a-zA-Z]:\//.test(given)
          ? given
          : `${ref.mapPath.replaceAll("\\", "/")}/${given.replace(/^\.\//, "")}`;
      if (name === "check_plugin") {
        const timeout = typeof args.timeout === "number" ? args.timeout : AGENT_TIMEOUT_MS;
        return text(await server.checkPlugin({ ...ref, plugin }, timeout));
      }
      if (name === "describe_plugin") {
        try {
          return text({ plugin, ...(await server.describePlugin({ ...ref, plugin })) });
        } catch (error) {
          if (!(error instanceof PluginMissing)) throw error;
          throw new Error(
            `Плагина ${plugin} нет. Встроенные плагины: ${error.builtins.join(", ")} — ` +
              "поставить в карту: add_plugin { name }.",
            { cause: error },
          );
        }
      }
      const timeout = typeof args.timeout === "number" ? args.timeout : AGENT_TIMEOUT_MS;
      const request = {
        ...ref,
        plugin,
        method: String(args.method ?? ""),
        args: typeof args.args === "object" && args.args !== null ? args.args : {},
      };
      if (args.wait !== "complete") {
        return text({ value: await server.pluginFirst(request, timeout) });
      }
      const values = await server.pluginAll(request, timeout);
      return text({ values });
    }

    if (name === "clear_build_cache") {
      return text(await server.clearBuildCache(ref));
    }

    if (name === "add_plugin") {
      const result = await server.installPlugin({
        ...ref,
        name: String(args.name ?? ""),
        ...(typeof args.path === "string" && args.path ? { path: args.path } : {}),
      });
      if (!result.ok) throw new Error(result.error);
      return text(result);
    }

    if (name === "market_search") {
      return text(
        await server.marketSearch({
          ...(typeof args.query === "string" ? { query: args.query } : {}),
          ...marketKind(args.kind),
        }),
      );
    }

    if (name === "market_read") {
      return text(
        await server.marketRead({
          name: String(args.name ?? ""),
          ...marketKind(args.kind),
          ...(typeof args.path === "string" && args.path ? { path: args.path } : {}),
          ...(typeof args.commit === "string" && args.commit ? { commit: args.commit } : {}),
        }),
      );
    }

    if (name === "market_add") {
      // Доверие агент не выдаёт: чужой код подтверждает человек в редакторе.
      const result = await server.marketAdd({
        ...ref,
        name: String(args.name ?? ""),
        ...marketKind(args.kind),
        ...(typeof args.path === "string" && args.path ? { path: args.path } : {}),
        ...(typeof args.parent === "string" && args.parent ? { parent: args.parent } : {}),
      });
      if (!result.ok) throw new Error(result.error);
      return text(result);
    }

    if (name === "market_diff") {
      return text(await server.marketDiff({ ...ref, path: String(args.path ?? "") }));
    }

    if (name === "read_run") {
      const run = server.readRun({ mapPath: ref.mapPath, id: String(args.id ?? "") });
      if (!run) throw new Error(`Прогона ${String(args.id)} нет`);
      return text(run);
    }

    if (name === "edit_map") {
      // Пачку проверяет схема до плана: агент шлёт что угодно, а ответ называет поле.
      const wrong = schemaErrors({ type: "array", items: MapEditOp }, args.ops);
      if (wrong.length > 0) throw new Error(`ops не той формы: ${wrong.join("; ")}`);
      return text(await server.editMap({ ...ref, ops: args.ops as MapEditOp[] }));
    }

    if (name === "undo_edit" || name === "redo_edit") {
      const id = String(args.id ?? "");
      return text(
        name === "undo_edit"
          ? await server.undoEdit({ ...ref, id })
          : await server.redoEdit({ ...ref, id }),
      );
    }

    throw new Error(`Инструмент ${name} не найден`);
  }

  return transport.onMessage((message) => {
    const request = message as Request;
    if (request.jsonrpc !== "2.0") return;

    if (request.method === "initialize") {
      reply(request.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "mapward", version: "0.0.0" },
      });
      return;
    }

    if (request.method === "tools/list") {
      reply(request.id, { tools: TOOLS });
      return;
    }

    if (request.method === "tools/call") {
      const params = (request.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      void call(String(params.name), params.arguments ?? {}).then(
        (result) => reply(request.id, result),
        (error: unknown) =>
          fail(request.id, error instanceof Error ? error.message : String(error)),
      );
      return;
    }

    // Уведомления идут без id и ответа не ждут.
    if (request.id !== undefined) fail(request.id, `Метод ${request.method} не поддержан`);
  });
}
