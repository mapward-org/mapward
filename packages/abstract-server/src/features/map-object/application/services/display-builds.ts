import { Observable } from "rxjs";
import { findMetricOwner } from "@mapward/core";
import type { DisplayBuild, MapObject } from "@mapward/core";
import type { ServerPorts } from "../../../../ports/index.ts";
import { basename, dirname } from "../../../../lib/path.ts";
import { debounce } from "../../../../lib/debounce.ts";
import { buildDisplay } from "../use-cases/build-display.ts";

type MapRef = { mapPath: string; basePath: string; name: string };

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
export function createDisplayBuilds(
  ports: ServerPorts,
  readMap: (ref: MapRef) => Promise<MapObject>,
) {
  const entries = new Map<string, Entry>();

  function rebuild(entry: string, state: Entry): Promise<DisplayBuild> {
    if (state.running) return state.running;
    const running = (async (): Promise<DisplayBuild> => {
      if (!ports.bundler) {
        return { errors: ["этот хост не умеет собирать компоненты"], builtAt: ports.clock.now() };
      }
      const output = await buildDisplay(ports.files, ports.bundler, {
        entry,
        basePath: state.basePath,
      });
      // Набор файлов меняется вместе с импортами — следим за тем, что прочитано сейчас.
      // Пока собирали, смотреть могли перестать: тогда и следить не за чем.
      state.stopWatch();
      if (entries.get(entry) === state) {
        state.stopWatch = watchAll(output.watched, () => state.changed());
      }
      return { ...output.build, builtAt: ports.clock.now() };
    })()
      .catch((error: unknown) => ({
        errors: [error instanceof Error ? error.message : String(error)],
        builtAt: ports.clock.now(),
      }))
      .then((build) => {
        state.running = undefined;
        state.last = build;
        for (const listener of state.listeners) listener(build);
        return build;
      });
    state.running = running;
    return running;
  }

  /** Вотчер на файл: у порта он на папку, поэтому отбор по имени. */
  function watchAll(paths: string[], onChange: () => void): () => void {
    const stops = paths.map((path) =>
      ports.files.watch(dirname(path), onChange, { include: [basename(path)] }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }

  function watch(ref: MapRef, metricAddress: string): Observable<DisplayBuild> {
    return new Observable<DisplayBuild>((subscriber) => {
      let alive = true;
      let release = noop;

      void (async () => {
        const map = await readMap(ref);
        const found = findMetricOwner(map, metricAddress);
        const component = found?.metric.config.display?.component;
        if (!alive) return;
        if (!component) {
          subscriber.next({
            errors: [
              found
                ? `у метрики ${metricAddress} не задан display.component`
                : `метрика ${metricAddress} не найдена`,
            ],
            builtAt: ports.clock.now(),
          });
          return;
        }

        let state = entries.get(component);
        if (!state) {
          const created: Entry = {
            listeners: new Set(),
            stopWatch: noop,
            changed: noop,
            basePath: ref.basePath,
          };
          const quiet = debounce(ports.timers, ports.clock, QUIET_MS, () => {
            if (entries.get(component) === created) void rebuild(component, created);
          });
          created.changed = quiet.tick;
          entries.set(component, created);
          state = created;
        }
        const listener = (build: DisplayBuild) => subscriber.next(build);
        state.listeners.add(listener);
        const held = state;
        release = () => {
          held.listeners.delete(listener);
          if (held.listeners.size > 0) return;
          // Смотреть больше некому — вотчеры гаснут, а собранное забывается: без слежки оно
          // может протухнуть молча.
          held.stopWatch();
          entries.delete(component);
        };

        if (state.last) subscriber.next(state.last);
        else void rebuild(component, state);
      })().catch((error: unknown) => subscriber.error(error));

      return () => {
        alive = false;
        release();
      };
    });
  }

  /** Разовая сборка без слежки — для `mapward display check`. */
  async function buildOnce(ref: MapRef, metricAddress: string): Promise<DisplayBuild> {
    const map = await readMap(ref);
    const found = findMetricOwner(map, metricAddress);
    const component = found?.metric.config.display?.component;
    if (!component) {
      return {
        errors: [`у метрики ${metricAddress} не задан display.component`],
        builtAt: ports.clock.now(),
      };
    }
    if (!ports.bundler) {
      return { errors: ["этот хост не умеет собирать компоненты"], builtAt: ports.clock.now() };
    }
    const output = await buildDisplay(ports.files, ports.bundler, {
      entry: component,
      basePath: ref.basePath,
    });
    return { ...output.build, builtAt: ports.clock.now() };
  }

  return { watch, buildOnce };
}
