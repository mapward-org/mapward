#!/usr/bin/env node
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process, { argv, cwd, exit } from "node:process";
import { bundleBuild, createMapServer, findMaps, serveMcp } from "@mapward/abstract-server";
import type { MapServer, PluginCheck } from "@mapward/abstract-server";
import { findMetricOwner, MAP_ROOT, memberOwner } from "@mapward/core";
import type { MapMetric, ResolvedMap } from "@mapward/core";
import { MARKET_USAGE, runMarket } from "./market-command.ts";
import { createPorts } from "./ports.ts";
import { stdioTransport } from "./stdio.ts";
import { announce, livePlatform, proxyMcp, serveMcpHttp } from "./platform.ts";

/**
 * Карта без редактора — решение 0014. Это же и доказательство переезда: если метрика
 * собирается из терминала, значит модель действительно не зависит от vscode.
 */
const USAGE = `mapward <команда>

  maps                        карты, видимые отсюда
  object [адрес] [карта]      объект целиком: поля, метрики со значениями, дети
  metric <адрес> [карта]      собрать метрику и напечатать результат
  action <адрес> [карта] [--input имя=значение]...
                              запустить экшон: шаги печатаются по ходу, код выхода —
                              чем кончился прогон
  mcp [карта]                 mcp-сервер над картой по stdio. Платформа карты уже жива
                              (редактор или другой mapward mcp, адрес — в
                              .mapward/platform.json) — команда становится её клиентом
  plugin add <имя> [папка]    скопировать встроенный плагин в первую карту: в
                              _plugins/<имя> или в папку от корня карты; есть папка —
                              отказ, существующая копия не перезаписывается
  plugin check <путь> [карта] работает ли плагин: сборка, процесс и рукопожатие,
                              самоописание, а у метрик, которые на него ссылаются, —
                              сборка компонента и пробный запрос для агента
${MARKET_USAGE}

Адрес метрики — mapward://<объект>/_metrics/<имя>, экшона — mapward://<объект>/_actions/<имя>. Карта выбирается по имени, если их
несколько; по умолчанию берётся первая.`;

/** Сколько ждать значение метрики: его отдаёт плагин, и у платформы своих сроков нет. */
const METRIC_TIMEOUT_MS = 10 * 60_000;

/** Значение метрики — её запрос для агента: метод плагина, как его видит и MCP. */
async function metricValue(server: MapServer, map: ResolvedMap, metric: MapMetric) {
  const request = metric.config.agent;
  if (!request) return { collected: false, hint: "у метрики нет запроса для агента" };
  try {
    return await server.pluginFirst(
      { ...map, plugin: request.plugin, method: request.method, args: request.params ?? {} },
      METRIC_TIMEOUT_MS,
    );
  } catch (error) {
    return { collected: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Собрать метрику — изменяющий метод `refresh` плагина её запроса, с теми же параметрами: так
 * спрашивается заново дорогая метрика (`agent.ask`). Нет такого метода — метрика собирается сама,
 * и ответ — её запрос.
 */
async function runMetric(server: MapServer, map: ResolvedMap, metric: MapMetric) {
  const request = metric.config.agent;
  if (!request) return metricValue(server, map, metric);
  const described = await server.describePlugin({ ...map, plugin: request.plugin });
  if (described.methods.refresh?.kind !== "mutation") return metricValue(server, map, metric);
  const values = await server.pluginAll(
    { ...map, plugin: request.plugin, method: "refresh", args: request.params ?? {} },
    METRIC_TIMEOUT_MS,
  );
  return values.at(-1);
}

/** Проверка плагина строками: агенту хватает их, чтобы чинить. */
function printCheck(check: PluginCheck): void {
  const marks = { ok: "✓", fail: "✗", skip: "·" } as const;
  console.log(check.plugin);
  for (const step of check.steps) {
    console.log(`${marks[step.status]} ${step.title}`);
    for (const line of step.lines) console.log(`  ${line}`);
  }
}

/** Сколько ждать каждый пробный запрос для агента у `plugin check`. */
const CHECK_TIMEOUT_MS = 30_000;

/** Карта по имени: без имени берётся первая, как и в остальных командах. */
function pick(maps: ResolvedMap[], name: string | undefined): ResolvedMap {
  const found = name ? maps.find((entry) => entry.name === name) : maps[0];
  if (!found) throw new Error(name ? `карта ${name} не найдена` : "карт не найдено");
  return found;
}

/**
 * `--input имя=значение` по одному на поле — решение 0038. Значения строками: сервер сам
 * приводит их к виду поля и отвечает ошибкой, если не вышло.
 */
function parseAction(args: string[]): {
  address?: string;
  map?: string;
  inputs: Record<string, string>;
} {
  const inputs: Record<string, string> = {};
  const positional: string[] = [];
  for (let at = 0; at < args.length; at++) {
    const arg = args[at] as string;
    if (arg === "--input") {
      const pair = args[++at] ?? "";
      const cut = pair.indexOf("=");
      if (cut > 0) inputs[pair.slice(0, cut)] = pair.slice(cut + 1);
      continue;
    }
    positional.push(arg);
  }
  const [address, map] = positional;
  return { ...(address ? { address } : {}), ...(map ? { map } : {}), inputs };
}

/** Экшон из терминала: тот же прогон, что по кнопке, и его видно в объекте на карте. */
async function runAction(
  ports: ReturnType<typeof createPorts>,
  maps: ResolvedMap[],
  args: string[],
): Promise<{ exitCode: number }> {
  const parsed = parseAction(args);
  if (!parsed.address) {
    console.error(USAGE);
    return { exitCode: 1 };
  }
  const map = pick(maps, parsed.map);
  const server = createMapServer(ports);
  const started = await server.runAction({
    ...map,
    action: parsed.address,
    inputs: parsed.inputs,
    source: "cli",
  });
  if (started.errors) {
    for (const [field, why] of Object.entries(started.errors)) console.error(`${field}: ${why}`);
    await server.stopPlugins();
    return { exitCode: 1 };
  }

  const id = String(started.id);
  // Шаги печатаются, когда кончаются: так видно, где идёт и на чём упало, не дожидаясь конца.
  let printed = 0;
  // Прогоны лежат у объекта экшона, и адрес экшона его называет: карту читать незачем.
  const owner = memberOwner(parsed.address) ?? "";
  const subscription = server
    .watchRuns({ mapPath: map.mapPath, address: owner })
    .subscribe((runs) => {
      const run = runs.find((entry) => entry.id === id);
      if (!run) return;
      for (const step of run.steps.slice(printed)) {
        if (step.status === "running") break;
        console.log(`— ${step.name}: ${step.status}`);
        if (step.output) console.log(step.output.trimEnd());
        if (step.log) console.error(step.log.trimEnd());
        printed++;
      }
    });

  const run = await server.waitRun({ mapPath: map.mapPath, id });
  subscription.unsubscribe();
  // Экшон — метод плагина: его процесс гаснет вместе с командой, а не по простою.
  await server.stopPlugins();
  if (run?.error) console.error(run.error);
  return { exitCode: run?.status === "success" ? 0 : 1 };
}

async function main(): Promise<void> {
  const [command, first, second, third] = argv.slice(2);
  const ports = createPorts();
  const maps = await findMaps(ports.files, cwd().replaceAll("\\", "/"));

  if (command === "maps") {
    if (maps.length === 0) {
      console.error("mapward.json не найден ни здесь, ни выше");
      exit(1);
    }
    for (const map of maps) console.log(`${map.name}\t${map.mapPath}`);
    return;
  }

  if (command === "object") {
    // Объект таким, каким его видит человек: мердж, подстановки и уже собранные значения —
    // первое значение запроса каждой метрики. Прогонов здесь нет — за ними `metric`.
    const map = pick(maps, second ?? undefined);
    const server = createMapServer(ports);
    const object = await server.readObject({ ...map, address: first ?? MAP_ROOT, depth: 1 });
    if (!object) throw new Error(`объект ${String(first)} не найден`);

    const values = await Promise.all(
      object.metrics.map((metric) => metricValue(server, map, metric)),
    );
    await server.stopPlugins();
    console.log(
      JSON.stringify(
        {
          address: object.address,
          name: object.name,
          prototypeName: object.prototypeName,
          path: object.path,
          props: object.props,
          metrics: object.metrics.map((metric, at) => ({
            key: metric.key,
            address: metric.address,
            label: metric.config.label ?? metric.key,
            value: values[at],
          })),
          directives: object.directives.map((file) => ({ name: file.name, status: file.status })),
          actions: object.actions.map((action) => action.key),
          children: object.children.map((child) => ({ address: child.address, name: child.name })),
        },
        null,
        2,
      ),
    );
    // Живая модель держит прочитанное и вотчер диска ещё полминуты после чтения (решение 0041):
    // разовая команда выходит сама, не дожидаясь их.
    exit(0);
  }

  if (command === "metric") {
    const address = first;
    if (!address) {
      console.error(USAGE);
      exit(1);
      return;
    }

    const map = second ? maps.find((entry) => entry.name === second) : maps[0];
    if (!map) {
      console.error(second ? `карта ${second} не найдена` : "карт не найдено");
      exit(1);
      return;
    }

    const server = createMapServer(ports);
    const owner = memberOwner(address);
    const holder = owner && (await server.readObject({ ...map, address: owner, depth: 0 }));
    const found = holder ? findMetricOwner(holder, address) : undefined;
    if (!found) throw new Error(`метрика ${address} не найдена`);
    const value = await runMetric(server, map, found.metric);
    await server.stopPlugins();
    console.log(JSON.stringify(value, null, 2));
    // Как у `object`: вотчер живой модели держит процесс.
    exit(0);
  }

  if (command === "action") {
    const { exitCode } = await runAction(ports, maps, argv.slice(3));
    exit(exitCode);
  }

  if (command === "market") {
    try {
      const code = await runMarket(ports, maps, argv.slice(3));
      // Вотчер живой модели держит процесс — выходим сами.
      exit(code);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      exit(1);
    }
    return;
  }

  if (command === "plugin" && first === "check") {
    if (!second) {
      console.error(USAGE);
      exit(1);
      return;
    }
    const map = pick(maps, third ?? undefined);
    const server = createMapServer(ports);
    // Путь — от папки, где запущена команда, как у любого пути в терминале.
    const check = await server.checkPlugin(
      { ...map, plugin: resolve(cwd(), second).replaceAll("\\", "/") },
      CHECK_TIMEOUT_MS,
    );
    await server.stopPlugins();
    printCheck(check);
    // Вотчер живой модели держит процесс — выходим сами.
    exit(check.ok ? 0 : 1);
  }

  if (command === "plugin" && first === "add") {
    if (!second) {
      console.error(USAGE);
      exit(1);
      return;
    }
    const map = pick(maps, undefined);
    const server = createMapServer(ports);
    const result = await server.installPlugin({
      ...map,
      name: second,
      ...(third ? { path: third } : {}),
    });
    if (!result.ok) {
      console.error(result.error);
      exit(1);
      return;
    }
    console.log(`плагин скопирован в ${result.plugin} и доверен; файлы:`);
    for (const file of result.files) console.log(`  ${file}`);
    if (result.dependencies) {
      console.log(`зависимости поставлены npm: ${result.dependencies.join(", ")}`);
    }
    exit(0);
  }

  if (command === "mcp") {
    const map = first ? maps.find((entry) => entry.name === first) : maps[0];
    if (!map) {
      console.error(first ? `карта ${first} не найдена` : "карт не найдено");
      exit(1);
      return;
    }
    // Одна платформа на карту: живая — значит, этот процесс только проводник до неё.
    const live = await livePlatform(map.mapPath);
    if (live) {
      process.stderr.write(
        `mapward: платформа карты уже жива (${live.host}), иду к ней: ${live.mcp}\n`,
      );
      proxyMcp(stdioTransport(), live.mcp);
      return;
    }

    // Сервер живёт, пока жив процесс: агент говорит с ним по stdio, а другие `mapward mcp` этой
    // карты — по http, адрес которого лежит в `.mapward/platform.json`.
    const server = createMapServer(ports);
    // Карта названа командой, но сервер всё равно отдаёт список: так обращается агент (0009).
    const served = first ? [map] : maps;
    // Из какого бандла отвечает сервер — решение 0039.
    const build = bundleBuild(fileURLToPath(import.meta.url), (path) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return undefined;
      }
    });
    serveMcp(server, served, stdioTransport(), build);
    const http = await serveMcpHttp((transport) => serveMcp(server, served, transport, build));
    const forget = announce(map.mapPath, {
      mcp: http.url,
      host: "cli",
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    // Агент закрыл stdin или процесс гасят — запись уходит вместе с ним.
    const leave = () => {
      forget();
      http.stop();
      void server.stopPlugins().finally(() => exit(0));
    };
    process.stdin.on("end", leave);
    process.on("SIGINT", leave);
    process.on("SIGTERM", leave);
    process.on("exit", forget);
    return;
  }

  console.error(USAGE);
  exit(1);
}

// Ошибка карты — это сообщение и ненулевой код, а не стек: cli читают люди и CI.
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
