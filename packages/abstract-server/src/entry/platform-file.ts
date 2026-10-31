/**
 * Одна платформа на карту: живая платформа пишет свой адрес в `<карта>/.mapward/platform.json`,
 * а `mapward mcp` сначала смотрит туда и, если платформа отвечает, становится её тонким клиентом.
 * Две платформы над одной картой — два набора процессов плагинов, два вотчера и два писателя в
 * одни файлы; так их не бывает.
 *
 * Здесь только форма записи и где она лежит: пишут, читают и проверяют её приложения — у них
 * диск и сеть.
 */

/** Запись живой платформы. */
export type PlatformRecord = {
  /** MCP по http: `POST` — вызов, ответ — в нём же. */
  mcp: string;
  /** Мост клиента по http — у редактора: им рисует плагин `screenshot`. */
  bridge?: string;
  /** Кто поднял: редактор или `mapward mcp`. */
  host: "vscode" | "cli";
  pid: number;
  startedAt: string;
};

const slash = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

/** Папка `.mapward` карты — локальное, вне git: сборки, прогоны, корзина и адрес платформы. */
export const localDir = (mapPath: string): string => `${slash(mapPath)}/.mapward`;

export const platformFile = (mapPath: string): string => `${localDir(mapPath)}/platform.json`;

/** Запись из файла; не та форма — нет записи: чужой или битый файл платформой не считается. */
export function parsePlatform(text: string | undefined): PlatformRecord | undefined {
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as Partial<PlatformRecord>;
    if (typeof value.mcp !== "string" || !/^https?:\/\//.test(value.mcp)) return undefined;
    return {
      mcp: value.mcp,
      ...(typeof value.bridge === "string" ? { bridge: value.bridge } : {}),
      host: value.host === "cli" ? "cli" : "vscode",
      pid: typeof value.pid === "number" ? value.pid : 0,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    };
  } catch {
    return undefined;
  }
}

export const formatPlatform = (record: PlatformRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;
