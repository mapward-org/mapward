import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Свои записи холста — `map-state.json` вьюх — и их отмена. Правку самой карты отменяет
 * платформа (`ctx.undoEdit`) по своим номерам; пачка холста помнит их и свои записи, и её отмена —
 * обе разом: сперва своё, потом карта, повтор — наоборот. Так перенос, увёзший папку со
 * `map-state.json`, отменяется в правильном порядке: свой файл возвращается там, где он сейчас, а
 * потом платформа возвращает папку на место.
 */

/** Диск холста: node, без платформы. Отдельно — чтобы тест мог подменить его памятью. */
export type Disk = {
  read(file: string): Promise<string | undefined>;
  write(file: string, text: string): Promise<void>;
  remove(file: string): Promise<void>;
};

const missing = (error: unknown) => (error as { code?: string }).code === "ENOENT";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Переименование на Windows отказывает, пока файл держит чужой вотчер или индексатор: это доли
 * секунды, поэтому несколько попыток, а не ошибка с первой.
 */
async function patient(run: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      return await run();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      // oxlint-disable-next-line no-await-in-loop
      await pause(50 * (attempt + 1));
    }
  }
}

let temp = 0;

export const nodeDisk: Disk = {
  read: async (file) => {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  },
  // Через временный файл и переименование: вотчер и читатель не увидят файл наполовину.
  write: async (file, text) => {
    await mkdir(path.dirname(file), { recursive: true });
    temp += 1;
    const draft = `${file}.${process.pid}-${temp}.tmp`;
    await writeFile(draft, text, "utf8");
    await patient(() => rename(draft, file));
  },
  remove: (file) => rm(file, { force: true }),
};

/** Запись холста: текст до и после. `undefined` — файла не было. */
type Written = { path: string; before: string | undefined; after: string };

/** Пачка холста: номера правок карты по порядку и свои записи по порядку. */
export type Pack = { id: string; state: "done" | "undone"; maps: string[]; files: Written[] };

/** Что делать с картой при откате пачки: отмена и повтор её правок у платформы. */
export type MapUndo = {
  undo(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  redo(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
};

export type Toggled = { ok: true; touched: string[] } | { ok: false; error: string };

/**
 * Пачки холста по номеру — в памяти процесса. Чья отмена следующая, журнал не решает: стек
 * держит тот, кто звал, — у холста свой, у агента свой. Процесс перезапустили — пачек нет, и
 * откатывают git.
 */
export class Journal {
  private counter = 0;
  /** Номер уникален и между перезапусками процесса. */
  private readonly epoch = Date.now().toString(36);
  private readonly packs = new Map<string, Pack>();

  constructor(private readonly disk: Disk) {}

  begin(): Pack {
    this.counter += 1;
    return { id: `${this.epoch}-${this.counter}`, state: "done", maps: [], files: [] };
  }

  /** Записать свой файл в пачку: запись помнит, каким он был. */
  async write(pack: Pack, file: string, text: string): Promise<boolean> {
    const before = await this.disk.read(file);
    if (before === text) return false;
    await this.disk.write(file, text);
    pack.files.push({ path: file, before, after: text });
    return true;
  }

  save(pack: Pack): void {
    this.packs.set(pack.id, pack);
  }

  find(id: string): Pack | undefined {
    return this.packs.get(id);
  }

  /** Свои записи назад, от последней к первой. */
  async unwrite(pack: Pack): Promise<string[]> {
    for (const written of pack.files.toReversed()) {
      // oxlint-disable-next-line no-await-in-loop
      if (written.before === undefined) await this.disk.remove(written.path);
      // oxlint-disable-next-line no-await-in-loop
      else await this.disk.write(written.path, written.before);
    }
    return pack.files.map((written) => written.path);
  }

  /** Свои записи вперёд, по порядку. */
  async rewrite(pack: Pack): Promise<string[]> {
    for (const written of pack.files) {
      // oxlint-disable-next-line no-await-in-loop
      await this.disk.write(written.path, written.after);
    }
    return pack.files.map((written) => written.path);
  }

  /** Какие свои файлы с тех пор поменяли мимо пачки: их не затираем. */
  private async drifted(pack: Pack, side: "before" | "after"): Promise<string[]> {
    const last = new Map<string, string | undefined>();
    const first = new Map<string, string | undefined>();
    for (const written of pack.files) {
      last.set(written.path, written.after);
      if (!first.has(written.path)) first.set(written.path, written.before);
    }
    const expected = side === "after" ? last : first;
    const changed: string[] = [];
    for (const [file, text] of expected) {
      // oxlint-disable-next-line no-await-in-loop
      if ((await this.disk.read(file)) !== text) changed.push(file);
    }
    return changed;
  }

  /** Отмена или повтор пачки: свои записи и правки карты, в нужном порядке. */
  async toggle(id: string, from: Pack["state"], map: MapUndo): Promise<Toggled> {
    const pack = this.packs.get(id);
    if (!pack) {
      return {
        ok: false,
        error: `Пачки ${id} нет: номер чужой или плагин перезапускали — откатывай git`,
      };
    }
    if (pack.state !== from) {
      return {
        ok: false,
        error: from === "done" ? `Пачка ${id} уже отменена` : `Пачка ${id} не отменена`,
      };
    }
    const changed = await this.drifted(pack, from === "done" ? "after" : "before");
    if (changed.length > 0) {
      return { ok: false, error: `Файлы поменяли мимо правки, не трогаю: ${changed.join(", ")}` };
    }
    const touched: string[] = [];
    if (from === "done") {
      touched.push(...(await this.unwrite(pack)));
      for (const [index, batch] of pack.maps.toReversed().entries()) {
        // oxlint-disable-next-line no-await-in-loop
        const result = await map.undo(batch);
        if (result.ok) continue;
        // Половина отката хуже никакого: сделанное возвращается, пачка остаётся какой была.
        for (const back of pack.maps.toReversed().slice(0, index).toReversed()) {
          // oxlint-disable-next-line no-await-in-loop
          await map.redo(back);
        }
        // oxlint-disable-next-line no-await-in-loop
        await this.rewrite(pack);
        return { ok: false, error: result.error };
      }
    } else {
      for (const [index, batch] of pack.maps.entries()) {
        // oxlint-disable-next-line no-await-in-loop
        const result = await map.redo(batch);
        if (result.ok) continue;
        for (const back of pack.maps.slice(0, index).toReversed()) {
          // oxlint-disable-next-line no-await-in-loop
          await map.undo(back);
        }
        return { ok: false, error: result.error };
      }
      touched.push(...(await this.rewrite(pack)));
    }
    pack.state = from === "done" ? "undone" : "done";
    return { ok: true, touched };
  }
}
