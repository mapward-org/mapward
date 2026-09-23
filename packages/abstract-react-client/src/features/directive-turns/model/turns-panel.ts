import { action, makeObservable, observable, reaction } from "mobx";
import { Popup } from "../../../lib/mobx/popup.ts";

/**
 * Список «ждут ответа» открыт или нет, и сколько сейчас времени: «сколько ждёт» стареет само,
 * и пока список открыт, время перерисовывается раз в минуту.
 */
export class TurnsPanel {
  readonly popup = new Popup();
  now = Date.now();
  private stop: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    makeObservable<TurnsPanel, "tick">(this, { now: observable, tick: action });
  }

  /** Пункт взят: список закрывается, директива открывается. */
  take<T>(turn: T, turns: { take(turn: T): void }): void {
    this.popup.close();
    turns.take(turn);
  }

  private tick(): void {
    this.now = Date.now();
  }

  mount(): void {
    this.popup.mount();
    this.stop = reaction(
      () => this.popup.open,
      (open) => {
        this.halt();
        if (!open) return;
        this.tick();
        this.timer = setInterval(() => this.tick(), 60_000);
      },
      { fireImmediately: true },
    );
  }

  unmount(): void {
    this.popup.unmount();
    this.stop?.();
    this.halt();
  }

  private halt(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
