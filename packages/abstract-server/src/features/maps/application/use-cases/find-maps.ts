import type { ResolvedMap } from "@mapward/core";
import type { FilesPort } from "../../../../ports/index.ts";
import { dirname, join } from "../../../../lib/path.ts";
import { CONFIG_FILE, INDEX_FILE, mapName, parseConfig } from "../../domain/config.ts";

/** Карты одного конфига, уже с абсолютными путями — по ним сервер читает карту. */
export async function mapsOfConfig(files: FilesPort, configPath: string): Promise<ResolvedMap[]> {
  const text = await files.read(configPath);
  if (!text) return [];

  const configDir = dirname(configPath);
  return Promise.all(
    parseConfig(text).map(async (entry) => {
      const mapPath = join(configDir, entry.mapUrl);
      const index = await files.read(join(mapPath, INDEX_FILE));
      return {
        name: mapName(index, mapPath),
        mapPath,
        basePath: join(configDir, entry.baseUrl),
        configPath,
      };
    }),
  );
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
  return configPath ? mapsOfConfig(files, configPath) : [];
}
