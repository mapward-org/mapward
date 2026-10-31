import { map as mapStream, Observable } from "rxjs";
import type { MapObject } from "@mapward/core";
import { LiveMap } from "./live-map.ts";
import type {
  ClockPort,
  FileReader,
  FileWatcher,
  FileWriter,
  TimersPort,
} from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { DiskFiles, keepFor, LiveFiles, pathKey } from "@mapward/vfs";

type Entry = { live: LiveMap; disk: DiskFiles };

/** Объект без детей — `own` — или с детьми без внуков — `children`. */
export type ObjectShape = "own" | "children";

const keyOf = (ref: MapRef) => `${pathKey(ref.mapPath)}|${pathKey(ref.basePath)}|${ref.name}`;

/**
 * Сколько прочитанный файл держится после того, как его перестали читать. Агент читает карту
 * сериями: `read_object`, следом `read_index` и `run_action` по тому же объекту — с паузами на
 * обдумывание в секунды, редко дольше полуминуты. Полминуты покрывают серию, и она не ходит на
 * диск за каждым ответом; пауза длиннее — уже темп человека, и одно чтение диска на неё
 * незаметно. Держать дольше — значит дольше держать вотчер на карту, в которую никто не смотрит.
 */
const KEEP_MS = 30_000;

/**
 * Карта на сервере — та же живая модель из `core`, что и у клиента (решение 0041), с диском в
 * роли источника файлов. Её берут все: подписки на метрики, экшоны, директивы и агент через
 * MCP.
 *
 * Читается то, что спросили, и столько, сколько спрашивают: объект по адресу — это путь к нему и
 * он сам, а не вся карта. Постоянной подписки на карту у сервера нет: неподписанный поток
 * забывает значение, и следующий вопрос читает диск заново, так что протухшего агент не увидит.
 * Чтобы серия вопросов не читала диск каждый раз, файл держится прочитанным и под вотчером ещё
 * `KEEP_MS` после последнего читателя.
 */
export class MapModel {
  private readonly maps = new Map<string, Entry>();
  private readonly disks = new Map<string, DiskFiles>();
  private readonly keep: () => Observable<unknown>;

  constructor(
    private readonly reader: FileReader,
    private readonly watcher: FileWatcher,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
  ) {
    this.keep = keepFor(timers, KEEP_MS);
  }

  /**
   * Объект по адресу, когда дочитан; нет такого — `undefined`. Читается путь к нему и он сам, а
   * с `children` — ещё его дети без внуков.
   */
  object(ref: MapRef, address: string, shape: ObjectShape = "own"): Promise<MapObject | undefined> {
    return this.subtree(ref, address, shape === "own" ? 0 : 1);
  }

  /** Объект по адресу и дальше каждое его изменение — как `object`, потоком. */
  object$(
    ref: MapRef,
    address: string,
    shape: ObjectShape = "own",
  ): Observable<MapObject | undefined> {
    return this.subtree$(ref, address, shape === "own" ? 0 : 1);
  }

  /**
   * Поддерево от адреса — для тех, кому оно нужно по смыслу: `depth` уровней детей, `Infinity` —
   * всё под объектом. Карты целиком у модели нет: всё под корнем — это явный `Infinity` от
   * корня, и вне `core` он записан исключением с причиной (`tests/subtree-depth.test.ts`).
   */
  subtree(ref: MapRef, address: string, depth: number): Promise<MapObject | undefined> {
    return this.entryOf(ref).live.subtree(address, depth);
  }

  /** Поддерево от адреса и дальше каждое его изменение. */
  subtree$(ref: MapRef, address: string, depth: number): Observable<MapObject | undefined> {
    return this.entryOf(ref).live.subtree$(address, depth);
  }

  /**
   * Перечитать всё, что карта сейчас читает, — кнопка рядом с навигацией. Нужна для того, чего
   * вотчер не видит: правки мимо редактора, которую он пропустил.
   */
  async reload(ref: MapRef): Promise<void> {
    await this.entryOf(ref).disk.reload();
  }

  /**
   * Объект для моста: свои поля и ближайшие дети без внуков, одно значение на пачку. Клиент
   * модели не собирает — он смотрит на эту; `null` — объекта по адресу нет.
   */
  view(ref: MapRef, address: string): Observable<MapObject | null> {
    return this.entryOf(ref)
      .live.view$(address)
      .pipe(mapStream((object) => object ?? null));
  }

  /** Предки объекта для крошек. */
  ancestors(ref: MapRef, address: string): Observable<{ address: string; name: string }[]> {
    return this.entryOf(ref).live.ancestors$(address);
  }

  /**
   * Запись, которую видно сразу. Сервер пишет файлы карты сам — директиву, её состояние,
   * реплику, — и тот, кто записал, следом читает карту: ждать вотчера ему нельзя. Поэтому все
   * записи сервера идут через эту обёртку, и изменённое перечитывается до того, как запись
   * считается сделанной.
   */
  writer(files: FileWriter): FileWriter {
    return {
      write: async (path, text) => {
        await files.write(path, text);
        await this.touched(path);
      },
      remove: async (path) => {
        await files.remove(path);
        await this.touched(path);
      },
    };
  }

  /**
   * Перечитать пути, которые сервер тронул мимо `writer`, — перенос и удаление папок правкой
   * карты (решение 0044). Папка перечитывается вместе со всем, что под ней читается.
   */
  async refresh(paths: string[]): Promise<void> {
    await Promise.all(paths.map((path) => this.touched(path)));
  }

  private async touched(path: string): Promise<void> {
    const hits = [...this.disks.values()].filter((disk) => disk.holds(path));
    await Promise.all(hits.map((disk) => disk.touch([path])));
  }

  private diskOf(mapPath: string): DiskFiles {
    const key = pathKey(mapPath);
    const existing = this.disks.get(key);
    if (existing) return existing;
    const created = new DiskFiles(mapPath, this.reader, this.watcher, this.timers, this.clock);
    this.disks.set(key, created);
    return created;
  }

  private entryOf(ref: MapRef): Entry {
    const key = keyOf(ref);
    const existing = this.maps.get(key);
    if (existing) return existing;

    const disk = this.diskOf(ref.mapPath);
    const live = new LiveMap(new LiveFiles(disk, this.keep), ref);
    const entry: Entry = { live, disk };
    this.maps.set(key, entry);
    return entry;
  }
}
