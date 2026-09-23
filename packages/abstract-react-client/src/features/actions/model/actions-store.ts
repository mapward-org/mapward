import type { ActionRef, MapAction, MapObject } from "@mapward/core";
import type { DisplayAction } from "@mapward/display";
import { keyClashes } from "../../../kernel/clashes.ts";
import { actionLabel } from "../pure-model/actions.ts";
import type { Launcher } from "./launcher.ts";

/** Где искать экшон, названный полным адресом: объект карты по адресу. */
export type ActionsMap = { find(address: string): MapObject | undefined };

/**
 * Кнопка экшона готовыми полями — её рисует `ui`, а решает, что на ней, стор. Сколько прогонов
 * идёт, спрашивается отдельно: число рисует своя вью рядом с кнопкой.
 */
export type ButtonView = {
  label: string;
  description?: string;
  /** Экшона нет: кнопка остаётся на месте и говорит об этом, а не пропадает молча. */
  missing?: string;
};

const described = (action: MapAction | undefined) =>
  action?.config.description === undefined ? {} : { description: action.config.description };

/**
 * Экшоны экрана — решение 0038. Кнопки в шапке, в клетке раскладки, на строке дисплея и в
 * компоненте запускают экшон одним путём — через `Launcher`, а число идущих прогонов берут у
 * прогонов объекта.
 */
export class ActionsStore {
  constructor(
    readonly launcher: Launcher,
    /** Сколько прогонов экшона идёт: прогоны одного экшона бывают параллельными. */
    readonly running: (address: string) => number,
    private readonly map: ActionsMap,
  ) {}

  /**
   * Какой экшон назван — решение 0038: ключ экшона объекта или полный адрес
   * `mapward://…/_actions/<ключ>`. Не нашёлся — `undefined`, и это ошибка строки, а не метрики.
   */
  resolve(object: MapObject, run: string): MapAction | undefined {
    if (!run.startsWith("mapward://")) return object.actions.find((one) => one.key === run);
    const owner = run.replace(/\/_actions\/[^/]+$/, "");
    return this.map.find(owner)?.actions.find((one) => one.address === run);
  }

  /** Экшоны, которые раскладка может поставить в клетку: ключ, занятый метрикой, — нет. */
  cells(object: MapObject): MapAction[] {
    const clashes = keyClashes(object.metrics, object.actions);
    return object.actions.filter((action) => !clashes.includes(action.key));
  }

  /** Экшоны объекта для компонента-дисплея: пропсом, с числом идущих прогонов. */
  list(object: MapObject): DisplayAction[] {
    return object.actions.map((action) => ({
      key: action.key,
      address: action.address,
      label: actionLabel(action),
      ...described(action),
      inputs: action.config.inputs ?? {},
      running: this.running(action.address),
    }));
  }

  button(action: MapAction): ButtonView {
    return {
      label: actionLabel(action),
      ...described(action),
    };
  }

  /** Кнопка по ссылке из данных метрики: экшона может и не быть. */
  buttonFor(object: MapObject, ref: ActionRef, label?: string): ButtonView {
    const action = this.resolve(object, ref.run);
    if (!action) return { label: label ?? ref.run, missing: ref.run };
    return { ...this.button(action), ...(label === undefined ? {} : { label }) };
  }

  /** Сколько прогонов идёт у экшона, названного строкой: не нашёлся — ни одного. */
  runningFor(object: MapObject, ref: ActionRef): number {
    const action = this.resolve(object, ref.run);
    return action ? this.running(action.address) : 0;
  }

  launch(action: MapAction): void {
    this.launcher.launch(action, {}, "ui");
  }

  /** Строка дисплея называет экшон ключом или адресом; не нашёлся — запускать нечего. */
  launchRef(object: MapObject, ref: ActionRef): void {
    const action = this.resolve(object, ref.run);
    if (action) this.launcher.launch(action, ref.inputs ?? {}, "display");
  }

  run(object: MapObject, run: string, inputs?: Record<string, unknown>): void {
    this.launchRef(object, inputs === undefined ? { run } : { run, inputs });
  }

  /** Форма запуска слушает Escape, пока открыта: жизнь ей даёт стор экшонов. */
  mount(): void {
    this.launcher.mount();
  }

  unmount(): void {
    this.launcher.unmount();
  }
}
