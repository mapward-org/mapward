#!/usr/bin/env node
import { argv, cwd, exit } from "node:process";
import { createMapServer, findMaps, parseSettings, serveMcp } from "@mapward/abstract-server";
import { createPorts } from "./ports.ts";
import { stdioTransport } from "./stdio.ts";

/**
 * Карта без редактора — решение 0014. Это же и доказательство переезда: если метрика
 * собирается из терминала, значит модель действительно не зависит от vscode.
 */
const USAGE = `mapward <команда>

  maps                        карты, видимые отсюда
  metric <адрес> [карта]      собрать метрику и напечатать результат
  mcp [карта]                 поднять mcp-сервер над картой

Адрес метрики — mapward://<объект>/_metrics/<имя>. Карта выбирается по имени, если их
несколько; по умолчанию берётся первая.`;

/** Настройки рантайма лежат в том же `mapward.json` — решение 0007. */
async function settingsOf(
  ports: ReturnType<typeof createPorts>,
  configPath: string,
): Promise<{ metricsConcurrency?: number }> {
  const text = await ports.files.read(configPath);
  return text ? parseSettings(text) : {};
}

async function main(): Promise<void> {
  const [command, first, second] = argv.slice(2);
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
