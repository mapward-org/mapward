import { Observable, Subject } from "rxjs";
import type { LogFilter, LogLine } from "@mapward/core";
import type { FileMover, FileReader, FileWriter, TimersPort } from "../../../ports/index.ts";
import {
  byTime,
  fileOfName,
  KEEP_LINES,
  LOGS_DIR,
  logPath,
  matches,
  MAX_BYTES,
  parseLines,
  serialize,
} from "../domain/log-file.ts";

/** Как часто уходит накопленное: болтливый плагин не должен писать на диск на каждой строке. */
const FLUSH_MS = 200;

/** Сколько строк отдаёт поток по умолчанию. */
const DEFAULT_LIMIT = 500;

type FileState = {
  /** Последние строки файла и его `.1`, по порядку записи. */
  lines: LogLine[];
  /** Размер файла на диске с тем, что уже дописано; `undefined` — ещё не спрашивали. */
  bytes?: number;
  /** Ещё не записанное. */
  pending: string;
  loading?: Promise<void>;
};

type MapLogs = {
  files: Map<string, FileState>;
  /** Список файлов на диске прочитан: «все логи» без него знали бы только писавших в этом окне. */
  listed?: Promise<void>;
  flushing: boolean;
  /** Цепочка записи: дописывание и ротация идут по очереди. */
  writing: Promise<void>;
};

/**
 * Логи карты — `.mapward/logs/`: единственный, кто туда пишет. Файл на плагин и `mapward.log`
 * для платформы; JSON Lines; 10 МБ на файл и одна предыдущая копия `.1`. Пишет пачками, не
 * задерживая вызов, и отдаёт строки по фильтру — сначала хвост из файлов, потом новые.
 */
export class LogStore {
  private readonly maps = new Map<string, MapLogs>();
  /** Пачка ушла: строки уже в памяти, подписчики перечитывают окно. */
  private readonly added = new Subject<string>();

  constructor(
    private readonly files: FileReader & FileWriter & Partial<FileMover>,
    private readonly timers: TimersPort,
  ) {}

  private mapOf(mapPath: string): MapLogs {
    const existing = this.maps.get(mapPath);
    if (existing) return existing;
    const created: MapLogs = { files: new Map(), flushing: false, writing: Promise.resolve() };
    this.maps.set(mapPath, created);
    return created;
  }

  private fileOf(mapPath: string, file: string): FileState {
    const logs = this.mapOf(mapPath);
    const existing = logs.files.get(file);
    if (existing) return existing;
    const created: FileState = { lines: [], pending: "" };
    logs.files.set(file, created);
    return created;
  }

  /** Файл с диска — один раз: `.1` и сам файл, последние строки. */
  private load(mapPath: string, file: string): Promise<void> {
    const state = this.fileOf(mapPath, file);
    state.loading ??= (async () => {
      const [old, current] = await Promise.all([
        this.files.read(logPath(mapPath, file, true)),
        this.files.read(logPath(mapPath, file)),
      ]);
      const read = [...parseLines(old ?? "", file), ...parseLines(current ?? "", file)];
      // Записанное в этом окне до чтения уже лежит в памяти — оно свежее прочитанного.
      state.lines = [...read, ...state.lines].slice(-KEEP_LINES);
      state.bytes ??= utf8Length(current ?? "");
    })();
    return state.loading;
  }

  private list(mapPath: string): Promise<void> {
    const logs = this.mapOf(mapPath);
    logs.listed ??= (async () => {
      const entries = await this.files.list(`${mapPath.replaceAll("\\", "/")}/${LOGS_DIR}`);
      const names = new Set<string>();
      for (const entry of entries) {
        const file = entry.isDirectory ? undefined : fileOfName(entry.name);
        if (file) names.add(file);
      }
      await Promise.all([...names].map((file) => this.load(mapPath, file)));
    })();
    return logs.listed;
  }

  /** Строка в лог. Уходит на диск пачкой, подписчикам — сразу с пачкой. */
  write(mapPath: string, line: LogLine): void {
    const state = this.fileOf(mapPath, line.file);
    state.lines.push(line);
    if (state.lines.length > KEEP_LINES) state.lines.splice(0, state.lines.length - KEEP_LINES);
    state.pending += serialize(line);
    const logs = this.mapOf(mapPath);
    if (logs.flushing) return;
    logs.flushing = true;
    this.timers.after(FLUSH_MS, () => {
      logs.flushing = false;
      void this.flush(mapPath);
    });
  }

  /** Всё накопленное — на диск. Тесты и остановка платформы зовут это сами. */
  flush(mapPath: string): Promise<void> {
    const logs = this.mapOf(mapPath);
    const batches: { file: string; text: string }[] = [];
    for (const [file, state] of logs.files) {
      if (state.pending === "") continue;
      batches.push({ file, text: state.pending });
      state.pending = "";
    }
    if (batches.length === 0) return logs.writing;
    // Подписчикам — сразу: строки уже в памяти, ждать диска им незачем.
    this.added.next(mapPath);
    logs.writing = logs.writing.then(async () => {
      for (const batch of batches) {
        try {
          await this.append(mapPath, batch.file, batch.text);
        } catch {
          // Лог — операционка: не записался — потеряна строка, а не вызов.
        }
      }
    });
    return logs.writing;
  }

  /** Всё накопленное по всем картам — когда платформа гаснет. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.maps.keys()].map((mapPath) => this.flush(mapPath)));
  }

  private async append(mapPath: string, file: string, text: string): Promise<void> {
    const state = this.fileOf(mapPath, file);
    const path = logPath(mapPath, file);
    let bytes = state.bytes;
    if (bytes === undefined) {
      const current = await this.files.read(path);
      bytes = current === undefined ? 0 : utf8Length(current);
      if (current === undefined) await this.ensureIgnored(mapPath);
    }
    const size = utf8Length(text);
    if (bytes > 0 && bytes + size > MAX_BYTES) {
      await this.rotate(mapPath, file);
      bytes = 0;
    }
    if (this.files.append) await this.files.append(path, text);
    else await this.files.write(path, ((await this.files.read(path)) ?? "") + text);
    state.bytes = bytes + size;
  }

  /** Файл становится `.1`, прежний `.1` уходит. */
  private async rotate(mapPath: string, file: string): Promise<void> {
    const current = logPath(mapPath, file);
    const old = logPath(mapPath, file, true);
    await this.files.remove(old);
    if (this.files.move) {
      await this.files.move(current, old);
      return;
    }
    await this.files.write(old, (await this.files.read(current)) ?? "");
    await this.files.remove(current);
  }

  /** Звёздочка внутри самой `.mapward`: корневой `.gitignore` человеку править не нужно. */
  private async ensureIgnored(mapPath: string): Promise<void> {
    const ignore = `${mapPath.replaceAll("\\", "/")}/.mapward/.gitignore`;
    if ((await this.files.read(ignore)) === undefined) await this.files.write(ignore, "*\n");
  }

  /** Строки по фильтру, последние `limit`, по времени. Без файла в фильтре читаются все файлы. */
  async read(mapPath: string, filter: LogFilter, limit = DEFAULT_LIMIT): Promise<LogLine[]> {
    if (filter.file !== undefined) await this.load(mapPath, filter.file);
    else await this.list(mapPath);
    return this.snapshot(mapPath, filter, limit);
  }

  private snapshot(mapPath: string, filter: LogFilter, limit: number): LogLine[] {
    const logs = this.mapOf(mapPath);
    const states =
      filter.file === undefined
        ? [...logs.files.values()]
        : [logs.files.get(filter.file)].filter((state) => state !== undefined);
    const found = states.flatMap((state) => state.lines.filter((line) => matches(line, filter)));
    return (states.length > 1 ? byTime(found) : found).slice(-limit);
  }

  /** Хвост файла из памяти — им хост объясняет, почему плагин упал. */
  tail(mapPath: string, file: string, count: number): LogLine[] {
    return (this.maps.get(mapPath)?.files.get(file)?.lines ?? []).slice(-count);
  }

  /**
   * Строки по фильтру потоком: сначала то, что есть, потом всё окно заново на каждую пачку
   * записи, где нашлось подходящее. Окно, а не добавка: подписчику по ту сторону моста не нужно
   * сшивать куски.
   */
  watch(mapPath: string, filter: LogFilter, limit = DEFAULT_LIMIT): Observable<LogLine[]> {
    return new Observable<LogLine[]>((subscriber) => {
      // Строки в памяти — одни и те же объекты: окно не поменялось, если не поменялись его длина
      // и последняя строка. Пачка без подходящего тогда ничего не шлёт.
      let tip: LogLine | undefined;
      let length = -1;
      const push = () => {
        const lines = this.snapshot(mapPath, filter, limit);
        if (lines.length === length && lines.at(-1) === tip) return;
        length = lines.length;
        tip = lines.at(-1);
        subscriber.next(lines);
      };
      const subscription = this.added.subscribe((changed) => {
        if (changed === mapPath) push();
      });
      void this.read(mapPath, filter, limit).then(push, (error: unknown) =>
        subscriber.error(error),
      );
      return () => subscription.unsubscribe();
    });
  }
}

/** Байты строки в UTF-8 — без `TextEncoder`: у сервера нет среды, и считать тут просто. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
