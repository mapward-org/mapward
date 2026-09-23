import { firstValueFrom, ReplaySubject, type Observable } from "rxjs";
import { MAP_ROOT } from "@mapward/core";
import type { MapObject } from "@mapward/core";
import type {
  ClockPort,
  FileReader,
  FileWatcher,
  FileWriter,
  TimersPort,
} from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { clone } from "../../../../lib/clone.ts";
import { assemble } from "../../domain/assemble.ts";
import type { Raw } from "../../domain/raw-object.ts";
import { FileStore, pathKey } from "./file-store.ts";
import { ObjectGraph } from "./object-graph.ts";

type Entry = { map$: ReplaySubject<MapObject>; store: FileStore };

const keyOf = (ref: MapRef) => `${pathKey(ref.mapPath)}|${pathKey(ref.basePath)}|${ref.name}`;

/**
 * Одна прочитанная карта на сервер — решение 0041. Её берут все: экран карты, подписки на
 * метрики, экшоны, директивы и агент через MCP. Раньше каждый из них читал карту с диска сам,
 * и переключение вкладки перечитывало её целиком.
 *
 * Карта заводится при первом обращении и живёт, пока жив сервер: вотчер у неё один и следит
 * всё это время, а не пока открыт экран, — иначе агент без открытого окна читал бы протухшее.
 * Наружу собранная карта уходит один раз на пачку изменений, после того как пачка разложена.
 */
export class MapModel {
  private readonly maps = new Map<string, Entry>();
  private readonly stores = new Map<string, FileStore>();

  constructor(
    private readonly reader: FileReader,
    private readonly watcher: FileWatcher,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
  ) {}

  /** Текущая карта. Пока она читается впервые, одновременные вызовы ждут одно чтение. */
  async current(ref: MapRef): Promise<MapObject> {
    const entry = this.entryOf(ref);
    await entry.store.idle();
    return firstValueFrom(entry.map$);
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
    await this.entryOf(ref).store.reload();
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
    const key = pathKey(path);
    const hits = [...this.stores.entries()].filter(
      ([root]) => key === root || key.startsWith(`${root}/`),
    );
    await Promise.all(hits.map(([, store]) => store.touch([path])));
  }

  private storeOf(mapPath: string): FileStore {
    const key = pathKey(mapPath);
    const existing = this.stores.get(key);
    if (existing) return existing;
    const created = new FileStore(mapPath, this.reader, this.watcher, this.timers, this.clock);
    this.stores.set(key, created);
    return created;
  }

  private entryOf(ref: MapRef): Entry {
    const key = keyOf(ref);
    const existing = this.maps.get(key);
    if (existing) return existing;

    const store = this.storeOf(ref.mapPath);
    const map$ = new ReplaySubject<MapObject>(1);
    const entry: Entry = { map$, store };
    this.maps.set(key, entry);

    // Сборка мутирует дерево, поэтому получает копию: прочитанное живёт дальше и соберётся снова.
    let latest: Raw | undefined;
    let dirty = false;
    // Папка может поменяться, не поменяв модели: у объекта появилась пустая `_metrics`, метрика
    // записала кэш. Такая сборка наружу не уходит — подписчику нечего перерисовывать.
    let published: string | undefined;
    const publish = () => {
      if (!dirty || latest === undefined) return;
      dirty = false;
      const text = JSON.stringify(latest);
      if (text === published) return;
      published = text;
      map$.next(assemble(clone(latest), ref.basePath));
    };

    new ObjectGraph(store, ref.mapPath).object(ref.mapPath, MAP_ROOT, ref.name).subscribe((raw) => {
      latest = raw;
      dirty = true;
      // Посреди пачки собранное может быть наполовину старым — отдаём, когда она разложена.
      if (!store.flushing) publish();
    });
    store.flushed$.subscribe(publish);

    return entry;
  }
}
