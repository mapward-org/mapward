#!/usr/bin/env node
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { argv, cwd, exit } from "node:process";
import {
  bundleBuild,
  createMapServer,
  findMaps,
  parseSettings,
  serveMcp,
} from "@mapward/abstract-server";
import type { Settings } from "@mapward/abstract-server";
import { findActionOwner } from "@mapward/core";
import type { MapObject, ResolvedMap } from "@mapward/core";
import { displayCheck } from "./display-check.ts";
import { createPorts } from "./ports.ts";
import { stdioTransport } from "./stdio.ts";

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
  mcp [карта]                 поднять mcp-сервер над картой
  display check <адрес> [карта]
                              дисплей-компонент метрики: тип данных по схеме, типы,
                              сборка и последнее значение против схемы

Адрес метрики — mapward://<объект>/_metrics/<имя>, экшона — mapward://<объект>/_actions/<имя>. Карта выбирается по имени, если их
несколько; по умолчанию берётся первая.`;

/** Настройки рантайма лежат в том же `mapward.json` — решение 0007. */
async function settingsOf(
  ports: ReturnType<typeof createPorts>,
  configPath: string,
): Promise<Settings> {
  const text = await ports.files.read(configPath);
  return text ? parseSettings(text) : {};
}

/** Карта по имени: без имени берётся первая, как и в остальных командах. */
function pick(maps: ResolvedMap[], name: string | undefined): ResolvedMap {
  const found = name ? maps.find((entry) => entry.name === name) : maps[0];
  if (!found) throw new Error(name ? `карта ${name} не найдена` : "карт не найдено");
  return found;
}

function find(object: MapObject, address: string): MapObject | undefined {
  if (object.address === address) return object;
  for (const child of object.children) {
    const found = find(child, address);
    if (found) return found;
  }
  return undefined;
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
  const server = createMapServer(ports, await settingsOf(ports, map.configPath));
  const started = await server.runAction({
    ...map,
    action: parsed.address,
    inputs: parsed.inputs,
    source: "cli",
  });
  if (started.errors) {
    for (const [field, why] of Object.entries(started.errors)) console.error(`${field}: ${why}`);
    return { exitCode: 1 };
  }

  const id = String(started.id);
  // Шаги печатаются, когда кончаются: так видно, где идёт и на чём упало, не дожидаясь конца.
  let printed = 0;
  const tree = await server.getMap(map);
  const owner = findActionOwner(tree, parsed.address)?.object.address ?? "";
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
    // Объект таким, каким его видит человек: мердж, подстановки и уже собранные значения.
    // Прогонов здесь нет — за ними `metric`.
    const map = pick(maps, second ?? undefined);
    const server = createMapServer(ports, await settingsOf(ports, map.configPath));
    const tree = await server.getMap(map);
    const object = first ? find(tree, first) : tree;
    if (!object) throw new Error(`объект ${String(first)} не найден`);

    const values = await server.readMetrics(map, object);
    console.log(
      JSON.stringify(
        {
          address: object.address,
          name: object.name,
          prototypeName: object.prototypeName,
          path: object.path,
          props: object.props,
          metrics: object.metrics.map((metric) => ({
            key: metric.key,
            address: metric.address,
            label: metric.config.label ?? metric.key,
            refresh: metric.config.refresh ?? "manual",
            display: metric.config.display?.kind,
            value: values[metric.address],
          })),
          directives: object.directives.map((file) => ({ name: file.name, status: file.status })),
          actions: object.actions.map((action) => action.key),
          children: object.children.map((child) => ({ address: child.address, name: child.name })),
        },
        null,
        2,
      ),
    );
    return;
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

    const server = createMapServer(ports, await settingsOf(ports, map.configPath));
    const value = await server.runMetric({ ...map, metric: address });
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (command === "action") {
    const { exitCode } = await runAction(ports, maps, argv.slice(3));
    exit(exitCode);
  }

  if (command === "display" && first === "check") {
    if (!second) {
      console.error(USAGE);
      exit(1);
      return;
    }
    const map = pick(maps, third ?? undefined);
    const server = createMapServer(ports, await settingsOf(ports, map.configPath));
    const ok = await displayCheck(ports, server, map, second);
    // Вотчеров здесь нет, но esbuild держит процесс — выходим сами.
    exit(ok ? 0 : 1);
  }

  if (command === "mcp") {
    const map = first ? maps.find((entry) => entry.name === first) : maps[0];
    if (!map) {
      console.error(first ? `карта ${first} не найдена` : "карт не найдено");
      exit(1);
      return;
    }
    // Сервер живёт, пока жив процесс: агент говорит с ним по stdio.
    serveMcp(
      createMapServer(ports, await settingsOf(ports, map.configPath)),
      // Карта названа командой, но сервер всё равно отдаёт список: так обращается агент (0009).
      first ? [map] : maps,
      stdioTransport(),
      // Из какого бандла отвечает сервер — решение 0039.
      bundleBuild(fileURLToPath(import.meta.url), (path) => {
        try {
          return statSync(path).mtimeMs;
        } catch {
          return undefined;
        }
      }),
    );
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
