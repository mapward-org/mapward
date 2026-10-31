import type { MapAction, MapObject } from "@mapward/core";
import type { ActionHandle } from "@mapward/component";
import type { ActionRef } from "../../../kernel/action-ref.ts";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";
import { actionLabel } from "../pure-model/actions.ts";
import type { Launcher } from "./launcher.ts";

/**
 * Где искать экшон, названный полным адресом: объект карты по адресу и его ресурс. Пока объект
 * не пришёл, `object` даёт `undefined`; вид, который его читает, подписан на `feed`.
 */
export type ActionsMap = {
  object(address: string): MapObject | undefined;
  feed(address: string): Watchable;
  /** Сервер ответил, что объекта нет; пока ответа нет — `false`. */
  missing(address: string): boolean;
};

/** Сколько прогонов экшона идёт: прогоны одного экшона бывают параллельными. */
export type RunCounts = Watchable & { running(address: string): number };

/** Объект, которому принадлежит экшон с полным адресом `mapward://…/_actions/<ключ>`. */
const ownerOf = (run: string) => run.replace(/\/_actions\/[^/]+$/, "");

/**
 * Экшоны экрана — решение 0038. Меню в шапке и компонент (`useAction`) запускают экшон одним
 * путём — через `Launcher`, а число идущих прогонов берут у прогонов объекта.
 */
export class ActionsStore extends Reactive {
  constructor(
    readonly launcher: Launcher,
    private readonly runs: RunCounts,
    private readonly map: ActionsMap,
  ) {
    super();
    // Форма запуска сюда не входит: её вид подписан на `launcher` сам, а кнопкам до неё дела нет.
    this.depend(runs);
  }

  /** Сколько прогонов экшона идёт. */
  running(address: string): number {
    return this.runs.running(address);
  }

  /**
   * Ресурс объекта, у которого искать экшон, названный строкой: полный адрес ведёт в чужой
   * объект. Ключ ищется у своего — ресурса нет. Вид, читающий такую кнопку, подписан и на него.
   */
  source(run: string): Watchable | undefined {
    return run.startsWith("mapward://") ? this.map.feed(ownerOf(run)) : undefined;
  }

  /**
   * Какой экшон назван — решение 0038: ключ экшона объекта или полный адрес
   * `mapward://…/_actions/<ключ>`. Не нашёлся — `undefined`, и это ошибка строки, а не метрики.
   */
  resolve(object: MapObject, run: string): MapAction | undefined {
    if (!run.startsWith("mapward://")) return object.actions.find((one) => one.key === run);
    return this.map.object(ownerOf(run))?.actions.find((one) => one.address === run);
  }

  /**
   * Экшон для компонента — `useAction`: подпись, идущие прогоны и запуск. Не нашёлся — подпись
   * ссылкой и `missing`, но только когда сервер ответил: объект-владелец, который ещё не пришёл,
   * — это «ещё не знаем», а не «нет».
   */
  handle(object: MapObject, ref: ActionRef): ActionHandle {
    const action = this.resolve(object, ref.run);
    return {
      label: action ? actionLabel(action) : ref.run,
      description: action?.config.description,
      missing: !action && !this.arriving(ref.run),
      running: action ? this.running(action.address) : 0,
      // Значения запуска — поверх тех, что даны хуку; экшона нет — запускать нечего.
      run: (inputs) => {
        if (action) this.launcher.launch(action, { ...ref.inputs, ...inputs }, "display");
      },
    };
  }

  /** Экшон назван полным адресом, а его объект ещё не пришёл с сервера. */
  private arriving(run: string): boolean {
    if (!run.startsWith("mapward://")) return false;
    const owner = ownerOf(run);
    return this.map.object(owner) === undefined && !this.map.missing(owner);
  }

  launch(action: MapAction): void {
    this.launcher.launch(action, {}, "ui");
  }

  /** Форма запуска слушает Escape, пока открыта: жизнь ей даёт стор экшонов. */
  mount(): void {
    this.launcher.mount();
  }

  unmount(): void {
    this.launcher.unmount();
  }
}
