import { Observable } from "rxjs";
import { findActionOwner, findMetricOwner, memberOwner } from "@mapward/core";
import type { ComponentBuild, MapObject } from "@mapward/core";
import { layoutFile } from "../../domain/layout-file.ts";
import type { ClockPort, FileWatcher, TimersPort } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { basename, dirname } from "../../../../lib/path.ts";
import { debounce } from "@mapward/vfs";
import type { DisplaysMapSource } from "../../ports.ts";
import type { BuildComponent } from "../use-cases/build-component.ts";
import type { BuildInputs } from "../../domain/build-inputs.ts";
import type { BuildCache } from "./build-cache.ts";

type Entry = {
  last?: ComponentBuild;
  /** Из чего собрана `last`: по этим ответам файлов её можно не повторять. */
  inputs?: BuildInputs;
  /** Прочитанное вне `node_modules` — за ним следят, пока смотрят. */
  watched: string[];
  /** Идёт сборка, сверка или чтение с диска — одно на компонент, сколько бы ни подписалось. */
  pending?: Promise<void>;
  /** Следим за файлами: сборка заведомо свежая. Не следим — свежесть надо проверить. */
  watching: boolean;
  listeners: Set<(build: ComponentBuild) => void>;
  stopWatch: () => void;
  /** Файл изменился: пересборка по тишине, а не на каждый тик. */
  changed: () => void;
  basePath: string;
  mapPath: string;
};

/** Правка пишет файл несколько раз подряд; пересобирать на каждый тик незачем. */
const QUIET_MS = 150;

const noop = () => {};

/**
 * Сборки компонентов — метрик, раскладок групп и форм экшонов, — решение 0037.
 *
 * Сборка одна на компонент, а не на подписчика: один `.tsx` бывает у многих наследников
 * прототипа, и сайдбар с табом смотрят на одно и то же. Пока смотрит хоть кто-то, за прочитанными
 * файлами вне `node_modules` следят и пересобирают на правку.
 *
 * Собранное не забывается, когда смотреть перестали, — вместе с ним помнятся его входы: все
 * ответы файлов сборщику (`BuildInputs`). Вернулся подписчик — получает прежнюю сборку сразу, а
 * сервер сверяет входы: те же — сборка та же, иначе пересобирает и присылает новую. Сборки лежат
 * и на диске карты (`BuildCache`): открытое окно начинает с них так же — показать и сверить.
 */
export class ComponentBuilds {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly map: DisplaysMapSource,
    private readonly build: BuildComponent,
    private readonly watcher: FileWatcher,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
    /** Без него сборки живут только в памяти: тесты и хосты без диска. */
    private readonly cache?: BuildCache,
  ) {}

  watch(ref: MapRef, metricAddress: string): Observable<ComponentBuild> {
    return this.follow(ref, () => this.componentOf(ref, metricAddress));
  }

  /**
   * Раскладка группы — тот же компонент для сборщика: `.tsx`, React и набор `@mapward/component`.
   * Сборка тоже одна на файл: раскладку прототипа делят все его наследники.
   */
  watchLayout(ref: MapRef, address: string, group: string): Observable<ComponentBuild> {
    return this.follow(ref, () => this.layoutOf(ref, address, group));
  }

  /** Своя форма экшона — тот же компонент для сборщика, с пропсами формы. */
  watchActionForm(ref: MapRef, action: string): Observable<ComponentBuild> {
    return this.follow(ref, () => this.actionFormOf(ref, action));
  }

  private follow(
    ref: MapRef,
    locate: () => Promise<string | ComponentBuild>,
  ): Observable<ComponentBuild> {
    return new Observable<ComponentBuild>((subscriber) => {
      let alive = true;
      let release = noop;

      void (async () => {
        const component = await locate();
        if (!alive) return;
        if (typeof component !== "string") {
          subscriber.next(component);
          return;
        }

        const state = this.entryOf(component, ref);
        const listener = (build: ComponentBuild) => subscriber.next(build);
        state.listeners.add(listener);
        release = () => {
          state.listeners.delete(listener);
          if (state.listeners.size > 0) return;
          // Смотреть больше некому — вотчеры гаснут. Собранное помнится, но уже не заведомо
          // свежим: вернувшийся подписчик его получит, а сервер сверит входы.
          state.stopWatch();
          state.stopWatch = noop;
          state.watching = false;
        };

        if (state.last) subscriber.next(state.last);
        if (!state.watching) void this.settle(component, state);
      })().catch((error: unknown) => subscriber.error(error));

      return () => {
        alive = false;
        release();
      };
    });
  }

  /** Разовая сборка без слежки — для `mapward plugin check`. */
  async buildOnce(ref: MapRef, metricAddress: string): Promise<ComponentBuild> {
    return this.once(ref, await this.componentOf(ref, metricAddress));
  }

  /** Разовая сборка раскладки группы — для `check` по объекту. */
  async buildLayoutOnce(ref: MapRef, address: string, group: string): Promise<ComponentBuild> {
    return this.once(ref, await this.layoutOf(ref, address, group));
  }

  /** Разовая сборка своей формы экшона — для `check` по экшону. */
  async buildActionFormOnce(ref: MapRef, action: string): Promise<ComponentBuild> {
    return this.once(ref, await this.actionFormOf(ref, action));
  }

  private async once(ref: MapRef, component: string | ComponentBuild): Promise<ComponentBuild> {
    if (typeof component !== "string") return component;
    return (await this.build.run({ entry: component, basePath: ref.basePath })).build;
  }

  /** Путь компонента метрики или ошибка сборки, которой его не нашлось. */
  private async componentOf(ref: MapRef, metricAddress: string): Promise<string | ComponentBuild> {
    const holder = await this.ownerOf(ref, metricAddress);
    const found = holder && findMetricOwner(holder, metricAddress);
    const component = found?.metric.config.component;
    if (component) return component;
    return {
      errors: [
        found
          ? `у метрики ${metricAddress} не задан component`
          : `метрика ${metricAddress} не найдена`,
      ],
      builtAt: this.clock.now(),
    };
  }

  /** Объект, у которого лежит метрика или экшон: читается он, а не вся карта. */
  private async ownerOf(ref: MapRef, address: string): Promise<MapObject | undefined> {
    const owner = memberOwner(address);
    return owner === undefined ? undefined : this.map.object(ref, owner);
  }

  /** Файл своей формы экшона или ошибка сборки, которой его не нашлось. */
  private async actionFormOf(ref: MapRef, address: string): Promise<string | ComponentBuild> {
    const holder = await this.ownerOf(ref, address);
    const found = holder && findActionOwner(holder, address);
    const component = found?.action.config.component;
    if (component) return component;
    return {
      errors: [found ? `у экшона ${address} не задан component` : `экшон ${address} не найден`],
      builtAt: this.clock.now(),
    };
  }

  /** Файл раскладки группы или ошибка сборки, которой его не нашлось. */
  private async layoutOf(
    ref: MapRef,
    address: string,
    key: string,
  ): Promise<string | ComponentBuild> {
    const object = await this.map.object(ref, address);
    const group = object?.metricGroups.find((one) => one.key === key);
    const file =
      object && group?.layout !== undefined
        ? layoutFile(group.layout, {
            mapPath: ref.mapPath,
            basePath: ref.basePath,
            objectPath: object.path,
          })
        : undefined;
    if (file) return file;
    const why = !object
      ? `объект ${address} не найден`
      : !group
        ? `у объекта ${address} нет группы «${key}»`
        : group.layout === undefined
          ? `у группы «${key}» не задан layout`
          : `layout группы «${key}» — не файл: ${group.layout}`;
    return { errors: [why], builtAt: this.clock.now() };
  }

  /**
   * Стереть сохранённые сборки карты — на диске и в памяти. Сборки, на которые сейчас смотрят,
   * собираются заново. Отдаёт, сколько файлов было на диске и сколько пересобирается.
   */
  async clearCache(ref: MapRef): Promise<{ removed: number; rebuilt: number }> {
    const removed = (await this.cache?.clear(ref.mapPath)) ?? 0;
    let rebuilt = 0;
    for (const [component, state] of this.entries) {
      if (state.mapPath !== ref.mapPath) continue;
      state.inputs = undefined;
      if (state.listeners.size === 0) {
        this.entries.delete(component);
        continue;
      }
      rebuilt += 1;
      void this.queue(state, () => this.rebuild(component, state));
    }
    return { removed, rebuilt };
  }

  private entryOf(component: string, ref: MapRef): Entry {
    const existing = this.entries.get(component);
    if (existing) return existing;
    const created: Entry = {
      watched: [],
      watching: false,
      listeners: new Set(),
      stopWatch: noop,
      changed: noop,
      basePath: ref.basePath,
      mapPath: ref.mapPath,
    };
    const quiet = debounce(this.timers, this.clock, QUIET_MS, () => {
      if (this.entries.get(component) === created && created.watching) {
        void this.queue(created, () => this.rebuild(component, created));
      }
    });
    created.changed = quiet.tick;
    this.entries.set(component, created);
    return created;
  }

  /** Одно дело на компонент за раз: сборка, сверка и чтение с диска не наступают друг на друга. */
  private queue(state: Entry, work: () => Promise<void>): Promise<void> {
    const next = (state.pending ?? Promise.resolve()).then(work, work);
    const tracked = next.finally(() => {
      if (state.pending === tracked) state.pending = undefined;
    });
    state.pending = tracked;
    return tracked;
  }

  /**
   * Довести сборку до заведомо свежей: что помнится — сверить, чего нет — поднять с диска и
   * сверить, не сошлось — собрать. Прежняя сборка уже у подписчика: новая придёт, только если
   * она другая.
   */
  private settle(component: string, state: Entry): Promise<void> {
    if (state.pending) return state.pending;
    return this.queue(state, async () => {
      if (state.watching || state.listeners.size === 0) return;
      if (!state.last && this.cache) {
        const cached = await this.cache.load(state.mapPath, component);
        if (cached && !state.last) {
          state.last = cached.build;
          state.inputs = cached.inputs;
          state.watched = cached.watched;
          this.emit(state, cached.build);
        }
      }
      if (state.last && state.inputs && (await this.build.fresh(state.inputs))) {
        this.startWatching(component, state);
        return;
      }
      await this.rebuild(component, state);
    });
  }

  private async rebuild(entry: string, state: Entry): Promise<void> {
    const output = await this.build.run({ entry, basePath: state.basePath });
    state.last = output.build;
    state.inputs = output.inputs;
    state.watched = output.watched;
    // Набор файлов меняется вместе с импортами — следим за тем, что прочитано сейчас. Пока
    // собирали, смотреть могли перестать: тогда и следить не за чем.
    state.stopWatch();
    state.stopWatch = noop;
    state.watching = false;
    this.startWatching(entry, state);
    this.emit(state, output.build);
    // Сборку с ошибками не сохраняем: её исправят, и собирать всё равно заново.
    if (this.cache && output.inputs && !output.build.errors?.length) {
      void this.cache.save(state.mapPath, {
        entry,
        build: output.build,
        inputs: output.inputs,
        watched: output.watched,
      });
    }
  }

  /** Сборка свежая и на неё смотрят — следить за её файлами, пока смотрят. */
  private startWatching(entry: string, state: Entry): void {
    if (this.entries.get(entry) !== state || state.listeners.size === 0 || state.watching) return;
    state.stopWatch = this.watchAll(state.watched, () => state.changed());
    state.watching = true;
  }

  private emit(state: Entry, build: ComponentBuild): void {
    for (const listener of state.listeners) listener(build);
  }

  /** Вотчер на файл: у порта он на папку, поэтому отбор по имени. */
  private watchAll(paths: string[], onChange: () => void): () => void {
    const stops = paths.map((path) =>
      this.watcher.watch(dirname(path), onChange, { include: [basename(path)] }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }
}
