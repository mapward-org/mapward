import { skip, type Observable } from "rxjs";
import type { MapsState, ResolvedMap } from "@mapward/core";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";

/** Что с картами и чем это чинится — готовым для вида. */
export type MapsScreen =
  | { kind: "loading" }
  | { kind: "empty"; text: string; action: string; onAction: () => void }
  | { kind: "one"; map: ResolvedMap }
  | { kind: "many"; sections: MapSection[] };

/** Карта аккордеоном: открыта ли и смонтирована ли уже. */
export type MapSection = { map: ResolvedMap; open: boolean; mounted: boolean };

export type MapsSource = Watchable & {
  current: MapsState | undefined;
  createConfig(): void;
  pickFolder(): void;
  openPath(path: string): void;
};

type Slot<T> = Watchable & { value: T; ready: boolean; set(value: T): void };

/**
 * Последняя просьба перейти к объекту — поток, начинающийся с текущей. Каждая — новый объект,
 * поэтому второе нажатие на ту же карту раскроет её снова, если её успели свернуть.
 */
export type RevealSource = { last$: Observable<{ mapPath: string } | undefined> };

/**
 * Карты сайдбара: одна — сразу её объект, несколько — аккордеоном. Свёрнутые
 * карты — путями, списком, в состоянии вида: вернётся карта, вернётся и её свёрнутость.
 *
 * Свёрнутая секция прячется, а не размонтируется: карта внутри держит раскрытое, выбранное и
 * прокрутку. Ни разу не открытая не монтируется вовсе — грузится при первом раскрытии.
 */
export class MapsView extends Reactive {
  /** Секции, которые уже открывали: их не размонтируют, даже когда свернут. */
  private readonly seen = this.state<ReadonlySet<string>>(new Set());

  private stop: (() => void) | undefined;

  constructor(
    private readonly source: MapsSource,
    private readonly closed: Slot<string[]>,
    private readonly reveal?: RevealSource | undefined,
  ) {
    super();
    this.depend(source, closed);
  }

  get screen(): MapsScreen {
    const state = this.source.current;
    if (!state) return { kind: "loading" };
    if (state.kind === "no-workspace") {
      return {
        kind: "empty",
        text: "Не открыта папка. Открой проект, в котором есть карта.",
        action: "Найти",
        onAction: () => this.source.pickFolder(),
      };
    }
    if (state.kind === "error") {
      const config = state.configPath;
      return {
        kind: "empty",
        text: state.message,
        action: config ? "Открыть mapward.json" : "Создать mapward.json",
        onAction: () => (config ? this.source.openPath(config) : this.source.createConfig()),
      };
    }
    if (state.kind === "no-config") {
      return {
        kind: "empty",
        text: "В проекте нет mapward.json — карту неоткуда взять.",
        action: "Создать mapward.json",
        onAction: () => this.source.createConfig(),
      };
    }
    // One map needs no chooser: the sidebar shows it as if there were no choice at all.
    const [only] = state.maps;
    if (state.maps.length === 1 && only) return { kind: "one", map: only };
    // Пока хранилище не ответило, неизвестно, какие карты свёрнуты: нарисованная раньше
    // свёрнутая карта успела бы смонтироваться и начать грузиться.
    if (!this.closed.ready) return { kind: "loading" };
    const closed = new Set(this.closed.value);
    return {
      kind: "many",
      sections: state.maps.map((map) => {
        const open = !closed.has(map.mapPath);
        return { map, open, mounted: open || this.seen.value.has(map.mapPath) };
      }),
    };
  }

  toggle(key: string): void {
    const closed = this.closed.value;
    const wasClosed = closed.includes(key);
    // Раскрытая хоть раз секция остаётся смонтированной: свернуть — не значит забыть.
    this.see(key);
    this.closed.set(wasClosed ? closed.filter((k) => k !== key) : [...closed, key]);
  }

  mount(): void {
    const reveal = this.reveal;
    if (!reveal) return;
    // Поток отдаёт и текущую просьбу; секцию раскрывает только новая, пришедшая при нас.
    const subscription = reveal.last$.pipe(skip(1)).subscribe((request) => {
      if (request) this.open(request.mapPath);
    });
    this.stop = () => subscription.unsubscribe();
  }

  unmount(): void {
    this.stop?.();
    this.stop = undefined;
  }

  /** Раскрыть секцию, если свёрнута, — к объекту в ней просят перейти. */
  open(key: string): void {
    this.see(key);
    const closed = this.closed.value;
    if (closed.includes(key)) this.closed.set(closed.filter((k) => k !== key));
  }

  private see(key: string): void {
    if (!this.seen.value.has(key)) this.seen.set(new Set([...this.seen.value, key]));
  }
}
