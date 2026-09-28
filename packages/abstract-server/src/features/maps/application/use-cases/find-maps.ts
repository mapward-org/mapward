import type { MountTarget, ResolvedMap } from "@mapward/core";
import type { FilesPort } from "../../../../ports/index.ts";
import { dirname, join, slash } from "../../../../lib/path.ts";
import {
  CONFIG_FILE,
  INDEX_FILE,
  mapName,
  parseConfig,
  parseMount,
  type MapEntry,
} from "../../domain/config.ts";

/** Чтение текста по пути: у сервера — порт файлов, у редактора — его файловая система. */
export type ReadText = (path: string) => Promise<string | undefined>;

/** Одна карта — одна папка, как ни пиши путь к ней. */
const pathKey = (path: string) => slash(path).toLowerCase();

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Записи `maps` конфига по пути — или почему их нет. */
async function entriesOf(read: ReadText, configPath: string): Promise<MapEntry[] | string> {
  const text = await read(configPath);
  if (!text) return `Нет ${CONFIG_FILE} по пути ${configPath}`;
  try {
    return parseConfig(text);
  } catch (error) {
    return message(error);
  }
}

/**
 * Куда ведут подключения карты. Путь считается от папки конфига, где подключение написано;
 * ошибка остаётся у своего имени, и остальные подключения работают.
 */
export async function resolveMounts(
  read: ReadText,
  configPath: string,
  mounts: Record<string, string> | undefined,
): Promise<Record<string, MountTarget> | undefined> {
  if (!mounts) return undefined;
  const configDir = dirname(configPath);
  const resolved = await Promise.all(
    Object.entries(mounts).map(async ([name, value]): Promise<[string, MountTarget]> => {
      const mount = parseMount(value);
      if (typeof mount === "string") return [name, { error: mount }];
      // Абсолютный путь — как есть: проект может лежать на другом диске.
      const target = /^([A-Za-z]:)?\//.test(slash(mount.config))
        ? slash(mount.config)
        : join(configDir, mount.config);
      const entries = await entriesOf(read, target);
      if (typeof entries === "string") return [name, { error: entries }];
      const entry = entries[mount.index];
      if (!entry) {
        return [name, { error: `В ${target} нет карты с номером ${String(mount.index)}` }];
      }
      return [
        name,
        { mapPath: join(dirname(target), entry.mapUrl), configPath: target, index: mount.index },
      ];
    }),
  );
  return Object.fromEntries(resolved);
}

async function mapOfEntry(
  read: ReadText,
  configPath: string,
  entry: MapEntry,
): Promise<ResolvedMap> {
  const configDir = dirname(configPath);
  const mapPath = join(configDir, entry.mapUrl);
  const index = await read(join(mapPath, INDEX_FILE));
  const mounts = await resolveMounts(read, configPath, entry.mounts);
  return {
    name: mapName(index, mapPath),
    mapPath,
    basePath: join(configDir, entry.baseUrl),
    configPath,
    ...(mounts === undefined ? {} : { mounts }),
  };
}

/** Карты одного конфига, уже с абсолютными путями — по ним сервер читает карту. */
export async function mapsOfConfig(read: ReadText, configPath: string): Promise<ResolvedMap[]> {
  const text = await read(configPath);
  if (!text) return [];
  return Promise.all(parseConfig(text).map((entry) => mapOfEntry(read, configPath, entry)));
}

/**
 * Карты, до которых дотягиваются только подключениями, — со своими подключениями: карта
 * проекта может подключать свои, и они работают внутри неё. Идёт по кругам, каждая карта
 * поднимается один раз — по папке, — поэтому и подключение по кругу не зацикливается.
 */
export async function mountedMaps(read: ReadText, maps: ResolvedMap[]): Promise<ResolvedMap[]> {
  const known = new Set(maps.map((map) => pathKey(map.mapPath)));
  const found: ResolvedMap[] = [];
  let round = maps;
  while (round.length > 0) {
    const targets = round
      .flatMap((map) => Object.values(map.mounts ?? {}))
      .filter((target) => "mapPath" in target)
      .filter((target) => {
        const key = pathKey(target.mapPath);
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
    // Круг за кругом, но внутри круга — разом: соседние подключения друг от друга не зависят.
    // oxlint-disable-next-line no-await-in-loop
    const next = await Promise.all(
      targets.map(async (target) => {
        const entries = await entriesOf(read, target.configPath);
        const entry = typeof entries === "string" ? undefined : entries[target.index];
        return entry ? mapOfEntry(read, target.configPath, entry) : undefined;
      }),
    );
    round = next.filter((map): map is ResolvedMap => map !== undefined);
    found.push(...round);
  }
  return found;
}

/** Вверх до корня файловой системы, первый найденный выигрывает — как ищут свои конфиги git и пакетные менеджеры (решение 0007). */
export async function findConfig(files: FilesPort, from: string): Promise<string | undefined> {
  let current = from;
  for (;;) {
    const candidate = join(current, CONFIG_FILE);
    // Последовательно и намеренно: поднимаемся до первого попадания и останавливаемся.
    // oxlint-disable-next-line no-await-in-loop
    if (await files.read(candidate)) return candidate;
    const parent = dirname(current);
    if (!parent || parent === current) return undefined;
    current = parent;
  }
}

/** Карты, видимые из директории: конфиг ищется вверх, дальше его карты. */
export async function findMaps(files: FilesPort, from: string): Promise<ResolvedMap[]> {
  const configPath = await findConfig(files, from);
  return configPath ? mapsOfConfig((path) => files.read(path), configPath) : [];
}
