import { Observable, ReplaySubject } from "rxjs";
import { LiveFiles, LiveMap } from "@mapward/core";
import type { FolderEntry, MapObject } from "@mapward/core";
import type {
  ClockPort,
  FileReader,
  FileWatcher,
  FileWriter,
  TimersPort,
} from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { DiskFiles, pathKey } from "./disk-files.ts";

type Entry = { live: LiveMap; map$: ReplaySubject<MapObject>; disk: DiskFiles };

const keyOf = (ref: MapRef) => `${pathKey(ref.mapPath)}|${pathKey(ref.basePath)}|${ref.name}`;

/**
 * Карта на сервере — та же живая модель из `core`, что и у клиента (решение 0041), с диском в
 * роли источника файлов. Её берут все: подписки на метрики, экшоны, директивы и агент через
 * MCP.
 *
 * Карта заводится при первом обращении и живёт, пока жив сервер: сервер держит подписку на неё
 * всю, поэтому файлы прочитаны и под вотчером всё это время, а не пока открыт экран, — иначе
 * агент без открытого окна читал бы протухшее.
 */
export class MapModel {
  private readonly maps = new Map<string, Entry>();
  private readonly disks = new Map<string, DiskFiles>();

  constructor(
    private readonly reader: FileReader,
    private readonly watcher: FileWatcher,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
  ) {}

  /** Текущая карта. Пока она читается впервые, одновременные вызовы ждут одно чтение. */
  current(ref: MapRef): Promise<MapObject> {
    return this.entryOf(ref).live.current();
  }

  /** Карта и дальше каждое её изменение: подписчик сразу получает то, что есть. */
  watch(ref: MapRef): Observable<MapObject> {
    return this.entryOf(ref).map$.asObservable();
  }

  /**
   * Перечитать всё, что карта сейчас читает, — кнопка рядом с навигацией. Нужна для того, чего
   * вотчер не видит: правки мимо редактора, которую он пропустил.
   */
  async reload(ref: MapRef): Promise<void> {
    await this.entryOf(ref).disk.reload();
  }

  /**
   * Файл карты для моста — решение 0041: клиент держит ту же модель и читает файлы сам, по
   * подписке. Отдаётся из того же чтения, что у сервера, и только внутри папки карты.
   */
  watchFile(ref: MapRef, path: string): Observable<string | null> {
    const disk = this.diskInside(ref, path);
    return new Observable((subscriber) => disk.file(path, (text) => subscriber.next(text ?? null)));
  }

  /** Папка карты для моста: содержимое и дальше каждое его изменение. */
  watchFolder(ref: MapRef, path: string): Observable<FolderEntry[]> {
    const disk = this.diskInside(ref, path);
    return new Observable((subscriber) => disk.list(path, (entries) => subscriber.next(entries)));
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

  private async touched(path: string): Promise<void> {
    const hits = [...this.disks.values()].filter((disk) => disk.holds(path));
    await Promise.all(hits.map((disk) => disk.touch([path])));
  }

  private diskInside(ref: MapRef, path: string): DiskFiles {
    const disk = this.diskOf(ref.mapPath);
    if (!disk.holds(path)) throw new Error(`Файл ${path} лежит вне карты ${ref.mapPath}`);
    return disk;
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
    const live = new LiveMap(new LiveFiles(disk), ref);
    const map$ = new ReplaySubject<MapObject>(1);
    // Подписка на всю карту держит её прочитанной и под вотчером; наружу карта уходит, когда
    // пачка изменений разложена, — промежуточной сборки модель не отдаёт.
    live.watch((map) => map$.next(map));
    const entry: Entry = { live, map$, disk };
    this.maps.set(key, entry);
    return entry;
  }
}
