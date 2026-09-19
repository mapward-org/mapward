import { findObject, trail } from "@mapward/core";
import type { MapObject } from "@mapward/core";
import type { MapServer } from "./server.ts";
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
 * Объект в том виде, в каком его видит человек — решение 0009: поля после мерджа и
 * подстановок, метрики со значениями и конфигом (там же `exclude` у детей), раскладки, по
 * которым они разложены на экране.
 */
async function describe(
  server: MapServer,
  ref: MapRef,
  root: MapObject,
  object: MapObject,
  options: ReadOptions,
): Promise<Record<string, unknown>> {
  const values = await server.readMetrics(ref, object, options);
  // Вверх по дереву — решение 0016: дети у объекта уже есть, а родителя без этого не видно,
  // и агент не мог уйти к соседу иначе как обходом от корня.
  const parents = trail(root, object.address)
    .slice(0, -1)
    .toReversed()
    .map((ancestor) => ({ address: ancestor.address, name: ancestor.name }));

  return {
    address: object.address,
    name: object.name,
    prototypeName: object.prototypeName,
    path: object.path,
    props: object.props,
    layout: { preview: object.previewLayout, details: object.detailsLayout },
    metrics: object.metrics.map((metric) => ({
      key: metric.key,
      address: metric.address,
      label: metric.config.label ?? metric.key,
      refresh: metric.config.refresh ?? "manual",
      display: metric.config.display?.kind,
      configPath: metric.configPath,
      // Конфиг целиком: в нём видно и коллекторы, и `exclude` у карты детей.
      config: metric.config,
      value: values[metric.address],
    })),
    directives: object.directives.map((file) => ({ name: file.name, status: file.status })),
    actions: object.actions.map((file) => file.name),
    /** От ближайшего родителя к корню: по ним поднимаются и уходят к соседям через их детей. */
    parents,
    children: object.children.map((child) => ({ address: child.address, name: child.name })),
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
      "Объект карты так, как его видит человек: поля после наследования и подстановок, список метрик, директив, родителей и детей. " +
      'С refresh: "on-display" дешёвые метрики досчитываются — зови так, чтобы увидеть то же, что человек на экране. ' +
      "По parents и children можно обойти карту целиком, не заглядывая в репозиторий.",
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
      "Сырой `_index.json` объекта, как он написан на диске — до наследования и подстановок.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес; без него корень" },
        map: { type: "string", description: "имя карты; без него первая" },
      },
    },
  },
  {
    name: "run_metric",
    description:
      "Запустить метрику и вернуть её значение. Это тот же прогон, что по кнопке: скрипт или агент, запись кэша.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "mapward:// адрес метрики" },
        map: { type: "string", description: "имя карты; без него первая" },
        timeout: {
          type: "number",
          description: "мс на стадию сбора; перебивает то, что задано на метрике",
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
  const mapOf = (name: unknown): MapRef => {
    const found = typeof name === "string" ? maps.find((map) => map.name === name) : maps[0];
    if (!found) throw new Error(`Карта ${String(name)} не найдена`);
    return found;
  };

  const reply = (id: Request["id"], result: unknown) =>
    transport.send({ jsonrpc: "2.0", id, result });

  const fail = (id: Request["id"], message: string) =>
    transport.send({ jsonrpc: "2.0", id, error: { code: -32_000, message } });

  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "list_maps") {
      return text(maps.map((entry) => ({ name: entry.name, mapPath: entry.mapPath })));
    }

    const ref = mapOf(args.map);

    if (name === "read_object") {
      const map = await server.getMap(ref);
      const address = typeof args.address === "string" ? args.address : undefined;
      const object = address ? findObject(map, address) : map;
      if (!object) throw new Error(`Объект ${String(address)} не найден`);
      return text(await describe(server, ref, map, object, readOptions(args)));
    }

    if (name === "read_index") {
      const map = await server.getMap(ref);
      const address = typeof args.address === "string" ? args.address : undefined;
      const object = address ? findObject(map, address) : map;
      if (!object) throw new Error(`Объект ${String(address)} не найден`);
      const raw = await server.readIndexFile(object.path);
      return text({ address: object.address, path: object.path, index: raw ?? null });
    }

    if (name === "run_metric") {
      const address = String(args.address ?? "");
      return text(await server.runMetric({ ...ref, metric: address, ...timeouts(args) }));
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
