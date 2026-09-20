import { findMetric, findObject, groupMetrics, trail } from "@mapward/core";
import type { MapFile, MapMetric, MapObject } from "@mapward/core";
import { LANGUAGES, section, sections } from "@mapward/docs";
import type { Language } from "@mapward/docs";
import type { MapServer } from "./server.ts";
import { projectDeep } from "../lib/projection.ts";
import { fit } from "../lib/budget.ts";
import type {
  MapRef,
  ReadOptions,
} from "../features/map-object/application/services/metric-store.ts";

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

const PROTOCOL = "2024-11-05";

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
  const counts = { total: files.length, new: 0, changed: 0, done: 0 };
  for (const file of files) {
    if (file.status !== undefined) counts[file.status]++;
  }
  const shown = all ? files : files.filter((file) => file.status !== "done");
  return {
    ...counts,
    files: shown.map((file) => ({
      ...fileOf(file),
      status: file.status,
      // Идущий этап видно с первой секунды: отметку ставит run_directive — решение 0017.
      ...(file.run === undefined ? {} : { run: file.run }),
      // Сколько кругов директива уже прошла: третий Брейншторм и первый читаются по-разному.
      ...(file.runs === undefined ? {} : { runs: file.runs }),
    })),
  };
}

/**
 * Что из объекта класть в ответ: отбор метрик по ключам, полнота списка директив и логи
 * прогона. Логи только по просьбе — они жирные, а нужны, когда разбираются, почему метрика
 * красная (решение 0016).
 */
export type View = { metrics?: string[]; group?: string; directives: boolean; logs: boolean };

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
  root: MapObject,
  object: MapObject,
  options: ReadOptions,
  depth: number,
  view: View,
  top = true,
): Promise<Record<string, unknown>> {
  // Отбор идёт до сбора: метрика, которую не просили, не должна и считаться — иначе `depth`
  // поднимает процессы по всему поддереву ради значений, которые тут же выбрасываются.
  const wanted = pickMetrics(object, view, top);
  const values = await server.readMetrics(ref, { ...object, metrics: wanted }, options);
  const logs = view.logs
    ? await Promise.all(wanted.map((metric) => server.readMetricLogs(metric)))
    : undefined;
  // Вверх по дереву — решение 0016: дети у объекта уже есть, а родителя без этого не видно,
  // и агент не мог уйти к соседу иначе как обходом от корня.
  //
  // Раскрытому ребёнку цепочка не нужна: он лежит внутри своего родителя, и повторять её у
  // каждого значит платить за одно и то же столько раз, сколько в ответе объектов.
  const parents = top
    ? trail(root, object.address)
        .slice(0, -1)
        .toReversed()
        .map((ancestor) => ({ address: ancestor.address, name: ancestor.name }))
    : undefined;

  return {
    address: object.address,
    name: object.name,
    prototypeName: object.prototypeName,
    path: object.path,
    props: object.props,
    // Раскладка и воркфлоу — только у верхнего объекта ответа, по тому же доводу, что и
    // `parents`: раскрытый ребёнок лежит внутри родителя, и повторять у каждого пять этапов
    // с путями значит платить за одно и то же столько раз, сколько в ответе объектов.
    // Понадобились у ребёнка — он спрашивается своим вызовом, и там он верхний.
    ...(top ? { layout: { preview: object.previewLayout, details: object.detailsLayout } } : {}),
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
          })),
        }),
    metrics: wanted.map((metric, at) => ({
      key: metric.key,
      address: metric.address,
      label: metric.config.label ?? metric.key,
      refresh: metric.config.refresh ?? "manual",
      display: metric.config.display?.kind,
      configPath: metric.configPath,
      // Заведена не здесь, а у прототипа: инвариант 0015 спрашивает именно это.
      ...(metric.owner === undefined ? {} : { owner: metric.owner }),
      /** Файлы, из которых собран конфиг: первый — `configPath`, дальше прототип и `extends`. */
      layers: metric.layers,
      // Конфиг целиком: в нём видно и коллекторы, и `exclude` у карты детей.
      config: metric.config,
      value: values[metric.address],
      ...(logs?.[at] === undefined ? {} : { logs: logs[at] }),
    })),
    directives: digest(object.directives, view.directives),
    actions: object.actions.map(fileOf),
    /**
     * Этапы, действующие на объекте: звать их теперь по имени, и узнать имя больше неоткуда —
     * по файлам не видно, что приехало от прототипа (решение 0017).
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
            object.children.map((child) =>
              describe(server, ref, root, child, options, depth - 1, view, false),
            ),
          )
        : object.children.map((child) => ({ address: child.address, name: child.name })),
    map: ref.name,
  };
}

const TOOLS = [
  {
    name: "list_maps",
    description: "Карты, которые отдаёт этот сервер. Имя карты указывается в остальных вызовах.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_object",
    description:
      "Объект карты так, как его видит человек: поля после наследования и подстановок, список метрик, директив, экшонов, родителей и детей. " +
      "layers — файлы, из которых собран мердж, у объекта и у каждой метрики: адрес и путь, от своего к дальнему прототипу. Сам конфиг слоя берётся read_index по этому адресу. " +
      'С refresh: "on-display" дешёвые метрики досчитываются — зови так, чтобы увидеть то же, что человек на экране. ' +
      "Весь контекст разом: depth уводит вглубь по детям, metrics отбирает метрики по ключам, fields — поля в ответе. " +
      "У объекта с вкладками (поле groups) метрики разложены по группам: group отбирает одну из них, " +
      "без него приходят метрики всех вкладок, а не названная ни в одной не приходит никогда — её не показывают и человеку. " +
      'Начинай с обзора — { depth: 2, metrics: [], fields: ["address", "name", "prototypeName", "path", "props", "directives"] } — ' +
      'и только потом зови нужные: { address, metrics: ["files"], refresh: "on-display" }. Названная одна метрика бюджетом не режется. ' +
      "Почти весь вес ответа сидит в metrics.value, поэтому metrics важнее fields. " +
      "layout и workflow приходят только у верхнего объекта ответа: у раскрытых детей они те же самые.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес; без него корень" },
        map: { type: "string", description: "имя карты; без него первая" },
        refresh: {
          type: "string",
          enum: ["none", "on-display"],
          description:
            'по умолчанию "none" — только собранное раньше; "on-display" досчитывает дешёвые метрики и дожидается их. Дорогие (refresh: manual) не запускаются никогда — для них run_metric',
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description:
            'какие метрики включить, по ключам: ["files", "architecture"]. Пустой список — ни одной, и это правильный обзорный вызов. Без параметра приходят все, вместе со значениями; невключённая метрика не считается вовсе',
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
            'насколько глубоко раскрыть детей: 0 (по умолчанию) — именами, 1 и больше — такими же объектами. Вместе с refresh: "on-display" считает дешёвые метрики на всём поддереве',
        },
        timeout: {
          type: "number",
          description: "мс на стадию сбора; перебивает то, что задано на метрике",
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
      "С file — текст директивы или экшона этого объекта по имени из read_object, включая доставшиеся от прототипа; " +
      "с tail — только его хвост. " +
      "С stage — текст этапа воркфлоу, не запуская его и не отмечая прогон.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "mapward:// адрес объекта или метрики; без него корень. Адрес метрики — тот, что в read_object",
        },
        map: { type: "string", description: "имя карты; без него первая" },
        file: {
          type: "string",
          description:
            'имя директивы или экшона объекта, как в ответе read_object: "create-package.md". Без него приходит _index.json',
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
      "Какие этапы есть у объекта, видно в read_object, поле workflow; без stage берётся первый.",
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
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["address", "directive"],
    },
  },
  {
    name: "finish_directive",
    description:
      "Отметить, что этап закончен. Этап, которому это поручено (marksDone), помечает директиву выполненной: " +
      "копию текста и время снимает сервер, писать _directives.state руками не надо.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес объекта директивы" },
        directive: { type: "string", description: "имя файла директивы" },
        stage: { type: "string", description: "имя этапа; без него — первый по порядку" },
        map: { type: "string", description: "имя карты; без него первая" },
      },
      required: ["address", "directive"],
    },
  },
  {
    name: "run_metric",
    description:
      "Запустить метрику и вернуть её значение. Это тот же прогон, что по кнопке: скрипт или агент, запись кэша. " +
      "Дорогая метрика переживает вызов: с wait: false управление возвращается сразу, а результат досматривается через read_object.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес метрики" },
        map: { type: "string", description: "имя карты; без него первая" },
        timeout: {
          type: "number",
          description: "мс на стадию сбора; перебивает то, что задано на метрике",
        },
        wait: {
          type: "boolean",
          description:
            "по умолчанию true — вызов дожидается значения. false отдаёт busy: true сразу и не ждёт: прогон идёт у сервера, и его досматривают read_object по этому же объекту",
        },
      },
      required: ["address"],
    },
  },
] as const;

/** Один `timeout` в вызове кладётся на обе стадии: зовущий думает про ожидание целиком. */
const timeouts = (args: Record<string, unknown>) =>
  typeof args.timeout === "number"
    ? { collectorsTimeout: args.timeout, transformsTimeout: args.timeout }
    : {};

const readOptions = (args: Record<string, unknown>): ReadOptions => ({
  ...timeouts(args),
  ...(args.refresh === "on-display" ? { refresh: "on-display" as const } : {}),
});

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

/**
 * Логи читаются с диска, поэтому спрашиваются заранее — по самой проекции: назвал
 * `metrics.logs`, значит они тебе и нужны. Отдельного флага для этого заводить незачем.
 */
const wantsLogs = (fields: string[] | undefined): boolean =>
  fields?.some((path) => path === "metrics.logs" || path.startsWith("metrics.logs.")) ?? false;

const view = (args: Record<string, unknown>): View => ({
  metrics: names(args.metrics),
  ...(typeof args.group === "string" ? { group: args.group } : {}),
  directives: args.directives === "all",
  logs: wantsLogs(names(args.fields)),
});

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
export function serveMcp(server: MapServer, maps: MapRef[], transport: McpTransport): () => void {
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
    if (name === "list_maps") {
      return text(maps.map((entry) => ({ name: entry.name, mapPath: entry.mapPath })));
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
      const map = await server.getMap(ref);
      const address = typeof args.address === "string" ? args.address : undefined;
      const object = address ? findObject(map, address) : map;
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

      const depth = typeof args.depth === "number" && args.depth > 0 ? Math.floor(args.depth) : 0;
      const described = await describe(
        server,
        ref,
        map,
        object,
        readOptions(args),
        depth,
        view(args),
      );
      const answer = projectDeep(described, names(args.fields));
      // Одна метрика, названная по имени, не режется. Отбор и бюджет иначе спорят: агент
      // делает ровно то, что велит дока — зовёт метрику поимённо, — и получает маркер вместо
      // значения, за которым звал. Отказаться от него нечем: ноль в `budget` снимает предел
      // и на соседних вызовах тоже.
      return text(picked?.length === 1 ? answer : fit(answer, budget(args)));
    }

    if (name === "read_index") {
      const map = await server.getMap(ref);
      const address = typeof args.address === "string" ? args.address : undefined;
      const object = address ? findObject(map, address) : map;

      // `_metrics` — служебная папка, объектом она не ищется, но у метрики есть собственный
      // адрес, и приходит он в ответе рядом с ключом. Поэтому сырой вид метрики спрашивается
      // тем же инструментом, а не своим параметром — решение 0019.
      if (!object) {
        const metric = address ? findMetric(map, address) : undefined;
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
        const found = [...object.directives, ...object.actions].find(
          (file) => file.name === wanted,
        );
        if (!found) {
          const known = [...object.directives, ...object.actions].map((f) => f.name).join(", ");
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
      return text(
        name === "run_directive"
          ? await server.runDirective(params)
          : await server.finishDirective(params),
      );
    }

    if (name === "run_metric") {
      const address = String(args.address ?? "");
      return text(
        await server.runMetric({
          ...ref,
          metric: address,
          ...timeouts(args),
          // Ждать по умолчанию: прогон зовут ради значения. `wait: false` нужен дорогой
          // метрике — прогон идёт дальше у сервера, а досматривается через read_object.
          ...(args.wait === false ? { wait: false } : {}),
        }),
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
