import { resolve } from "node:path";
import { cwd } from "node:process";
import { createMapServer, type MarketKind } from "@mapward/abstract-server";
import type { ResolvedMap } from "@mapward/core";
import type { createPorts } from "./ports.ts";

export const MARKET_USAGE = `  market search [слова]...    найти в реестре плагины и куски карты (--kind plugin|map)
  market read <имя> [файл]    исходники до установки: дерево файлов и README или файл
                              (--commit <sha> — на коммите вместо ветки)
  market add <имя>            поставить копией в первую карту: плагин — в _plugins/<имя>
                              (--path папка), кусок карты — под --parent <адрес>;
                              --trust — доверить плагин сразу (вы его прочитали),
                              --map <имя> — карта
  market diff <папка>         поставленное против записанного коммита и ветки автора
                              Реестр — mapward-org/market на GitHub; MAPWARD_MARKET —
                              другой адрес или папка с plugins.json и maps.json`;

type Parsed = { positional: string[]; flags: Record<string, string | true> };

function parse(args: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let at = 0; at < args.length; at++) {
    const arg = args[at] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "trust") {
      flags[name] = true;
      continue;
    }
    flags[name] = args[++at] ?? "";
  }
  return { positional, flags };
}

const flag = (parsed: Parsed, name: string) =>
  typeof parsed.flags[name] === "string" && parsed.flags[name]
    ? (parsed.flags[name] as string)
    : undefined;

function kindOf(parsed: Parsed): { kind?: MarketKind } {
  const kind = flag(parsed, "kind");
  if (kind === undefined) return {};
  if (kind !== "plugin" && kind !== "map") throw new Error(`--kind — plugin или map, а не ${kind}`);
  return { kind };
}

function pick(maps: ResolvedMap[], name: string | undefined): ResolvedMap {
  const found = name ? maps.find((entry) => entry.name === name) : maps[0];
  if (!found)
    throw new Error(name ? `карта ${name} не найдена` : "mapward.json не найден ни здесь, ни выше");
  return found;
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** `mapward market …`: тот же маркетплейс, что у агента в MCP. Код выхода — удалось ли. */
export async function runMarket(
  ports: ReturnType<typeof createPorts>,
  maps: ResolvedMap[],
  args: string[],
): Promise<number> {
  const [action, ...rest] = args;
  const parsed = parse(rest);
  const server = createMapServer(ports);

  if (action === "search") {
    const result = await server.marketSearch({
      query: parsed.positional.join(" "),
      ...kindOf(parsed),
    });
    for (const error of result.errors ?? []) console.error(error);
    if (result.entries.length === 0)
      console.error(`в реестре ${result.registry} ничего не нашлось`);
    for (const entry of result.entries) {
      console.log(
        `${entry.name}\t${entry.kind}\t${entry.repo}#${entry.branch}\t${entry.description}`,
      );
    }
    return 0;
  }

  if (action === "read") {
    const [name, path] = parsed.positional;
    if (!name) throw new Error(MARKET_USAGE);
    const commit = flag(parsed, "commit");
    const result = await server.marketRead({
      name,
      ...kindOf(parsed),
      ...(path ? { path } : {}),
      ...(commit ? { commit } : {}),
    });
    if ("text" in result) console.log(result.text);
    else print(result);
    return 0;
  }

  if (action === "add") {
    const [name] = parsed.positional;
    if (!name) throw new Error(MARKET_USAGE);
    const map = pick(maps, flag(parsed, "map"));
    const path = flag(parsed, "path");
    const parent = flag(parsed, "parent");
    const result = await server.marketAdd({
      ...map,
      name,
      ...kindOf(parsed),
      ...(path ? { path } : {}),
      ...(parent ? { parent } : {}),
      trusted: parsed.flags.trust === true,
    });
    await server.stopPlugins();
    if (!result.ok) {
      console.error(result.error);
      return 1;
    }
    print(result);
    if (result.kind === "plugin" && !result.trusted) {
      console.error(
        "плагин не доверен: прочитайте его и подтвердите в редакторе, или поставьте с --trust",
      );
    }
    return 0;
  }

  if (action === "diff") {
    const [path] = parsed.positional;
    if (!path) throw new Error(MARKET_USAGE);
    const map = pick(maps, flag(parsed, "map"));
    // Путь — от папки, где запущена команда, как у любого пути в терминале.
    print(await server.marketDiff({ ...map, path: resolve(cwd(), path).replaceAll("\\", "/") }));
    return 0;
  }

  throw new Error(MARKET_USAGE);
}
