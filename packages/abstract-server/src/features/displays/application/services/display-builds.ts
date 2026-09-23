import { Observable } from "rxjs";
import { findMetricOwner } from "@mapward/core";
import type { DisplayBuild } from "@mapward/core";
import type { ClockPort, FileWatcher, TimersPort } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { basename, dirname } from "../../../../lib/path.ts";
import { debounce } from "../../../../lib/debounce.ts";
import type { DisplaysMapSource } from "../../ports.ts";
import type { BuildDisplay } from "../use-cases/build-display.ts";

type Entry = {
  last?: DisplayBuild;
  running?: Promise<DisplayBuild>;
  listeners: Set<(build: DisplayBuild) => void>;
  stopWatch: () => void;
  /** Файл изменился: пересборка по тишине, а не на каждый тик. */
  changed: () => void;
  basePath: string;
};

/** Правка пишет файл несколько раз подряд; пересобирать на каждый тик незачем. */
const QUIET_MS = 150;

const noop = () => {};

/**
 * Сборки дисплеев-компонентов — решение 0037.
 *
 * Сборка одна на компонент, а не на подписчика: один `.tsx` бывает у многих наследников
 * прототипа, и сайдбар с табом смотрят на одно и то же. Держится, пока смотрит хоть кто-то, и
 * пересобирается, когда меняется любой прочитанный ею файл вне `node_modules`.
 */
export class DisplayBuilds {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly map: DisplaysMapSource,
    private readonly build: BuildDisplay,
    private readonly watcher: FileWatcher,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
  ) {}

  watch(ref: MapRef, metricAddress: string): Observable<DisplayBuild> {
    return new Observable<DisplayBuild>((subscriber) => {
      let alive = true;
      let release = noop;

      void (async () => {
        const component = await this.componentOf(ref, metricAddress);
        if (!alive) return;
        if (typeof component !== "string") {
          subscriber.next(component);
          return;
        }

        const state = this.entryOf(component, ref.basePath);
        const listener = (build: DisplayBuild) => subscriber.next(build);
        state.listeners.add(listener);
        release = () => {
          state.listeners.delete(listener);
          if (state.listeners.size > 0) return;
          // Смотреть больше некому — вотчеры гаснут, а собранное забывается: без слежки оно
          // может протухнуть молча.
          state.stopWatch();
          this.entries.delete(component);
        };

        if (state.last) subscriber.next(state.last);
        else void this.rebuild(component, state);
      })().catch((error: unknown) => subscriber.error(error));

      return () => {
        alive = false;
        release();
      };
    });
  }

  /** Разовая сборка без слежки — для `mapward display check`. */
  async buildOnce(ref: MapRef, metricAddress: string): Promise<DisplayBuild> {
    const component = await this.componentOf(ref, metricAddress);
    if (typeof component !== "string") return component;
    return (await this.build.run({ entry: component, basePath: ref.basePath })).build;
  }

  /** Путь компонента метрики или ошибка сборки, которой его не нашлось. */
  private async componentOf(ref: MapRef, metricAddress: string): Promise<string | DisplayBuild> {
    const map = await this.map.current(ref);
    const found = findMetricOwner(map, metricAddress);
    const component = found?.metric.config.display?.component;
    if (component) return component;
    return {
      errors: [
        found
          ? `у метрики ${metricAddress} не задан display.component`
          : `метрика ${metricAddress} не найдена`,
      ],
      builtAt: this.clock.now(),
    };
  }

  private entryOf(component: string, basePath: string): Entry {
    const existing = this.entries.get(component);
    if (existing) return existing;
    const created: Entry = { listeners: new Set(), stopWatch: noop, changed: noop, basePath };
    const quiet = debounce(this.timers, this.clock, QUIET_MS, () => {
      if (this.entries.get(component) === created) void this.rebuild(component, created);
    });
    created.changed = quiet.tick;
    this.entries.set(component, created);
    return created;
  }

  private rebuild(entry: string, state: Entry): Promise<DisplayBuild> {
    if (state.running) return state.running;
    const running = this.build.run({ entry, basePath: state.basePath }).then((output) => {
      // Набор файлов меняется вместе с импортами — следим за тем, что прочитано сейчас.
      // Пока собирали, смотреть могли перестать: тогда и следить не за чем.
      state.stopWatch();
      if (this.entries.get(entry) === state) {
        state.stopWatch = this.watchAll(output.watched, () => state.changed());
      }
      state.running = undefined;
      state.last = output.build;
      for (const listener of state.listeners) listener(output.build);
      return output.build;
    });
    state.running = running;
    return running;
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
