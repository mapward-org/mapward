import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  formatPlatform,
  localDir,
  parsePlatform,
  platformFile,
  type PlatformRecord,
} from "@mapward/abstract-server";

/**
 * Живая платформа о себе — `<карта>/.mapward/platform.json` у каждой карты окна: `mapward mcp`
 * найдёт её там и станет её клиентом, а не второй платформой. Уходит запись вместе с окном;
 * убирается только своя — файл, который успела переписать другая платформа, не трогается.
 *
 * Синхронно: снимают запись на закрытии окна, и ждать там некого.
 */
export function announcePlatform(maps: { mapPath: string }[], record: PlatformRecord): () => void {
  const written: string[] = [];
  for (const { mapPath } of maps) {
    try {
      mkdirSync(localDir(mapPath), { recursive: true });
      // `.mapward` — локальное: в git ему не место.
      const ignore = `${localDir(mapPath)}/.gitignore`;
      if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
      writeFileSync(platformFile(mapPath), formatPlatform(record));
      written.push(platformFile(mapPath));
    } catch (error) {
      console.warn(`mapward: адрес платформы не записать в ${mapPath}`, error);
    }
  }
  return () => {
    for (const file of written) {
      try {
        if (parsePlatform(readFileSync(file, "utf8"))?.mcp === record.mcp) rmSync(file);
      } catch {
        // Файла уже нет — убирать нечего.
      }
    }
  };
}
