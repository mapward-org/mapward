import type { ComponentBuild } from "@mapward/core";
import type { FileReader, FileWriter } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";
import { fingerprint, type BuildInputs } from "../../domain/build-inputs.ts";

/** Сохранённая сборка: что собрано, из чего и чем. */
export type CachedBuild = {
  stamp: string;
  entry: string;
  build: ComponentBuild;
  inputs: BuildInputs;
  /** Прочитанное вне `node_modules` — за ним следят, пока на сборку смотрят. */
  watched: string[];
};

/** `.mapward` — локальное карты: сборки, прогоны, корзина; в git ему не место. */
const dirOf = (mapPath: string) => join(mapPath, ".mapward", "builds");

/**
 * Сборки компонентов на диске карты, в `.mapward/builds/`: открытое окно рисует метрики сразу,
 * а не «собирается» на каждой, пока поднимается сборщик. Файл — на компонент, имя — отпечаток его
 * пути. Верит сохранённому не он: годится ли сборка, решает сверка её входов (`fresh`).
 */
export class BuildCache {
  constructor(
    private readonly files: FileReader & FileWriter,
    /** Версия того, чем собирают: другая — сохранённое не годится. */
    private readonly stamp: string,
  ) {}

  private fileOf(mapPath: string, entry: string): string {
    return join(dirOf(mapPath), `${fingerprint(entry)}.json`);
  }

  async load(mapPath: string, entry: string): Promise<CachedBuild | undefined> {
    try {
      const text = await this.files.read(this.fileOf(mapPath, entry));
      if (text === undefined) return undefined;
      const cached = JSON.parse(text) as CachedBuild;
      // Другой сборщик или чужой файл с тем же отпечатком — как будто сохранённого нет.
      return cached.stamp === this.stamp && cached.entry === entry ? cached : undefined;
    } catch {
      return undefined;
    }
  }

  /** Записать не вышло — не беда: в следующий раз просто соберётся заново. */
  async save(mapPath: string, cached: Omit<CachedBuild, "stamp">): Promise<void> {
    try {
      await this.files.write(join(mapPath, ".mapward", ".gitignore"), "*\n");
      await this.files.write(
        this.fileOf(mapPath, cached.entry),
        JSON.stringify({ stamp: this.stamp, ...cached }),
      );
    } catch {
      // Кэш — ускорение, а не данные: без него всё работает.
    }
  }

  /** Стереть все сохранённые сборки карты. Отдаёт, сколько файлов было. */
  async clear(mapPath: string): Promise<number> {
    const dir = dirOf(mapPath);
    const files = (await this.files.list(dir).catch(() => [])).filter(
      (entry) => !entry.isDirectory && entry.name.endsWith(".json"),
    );
    await Promise.all(files.map((entry) => this.files.remove(join(dir, entry.name))));
    return files.length;
  }
}
