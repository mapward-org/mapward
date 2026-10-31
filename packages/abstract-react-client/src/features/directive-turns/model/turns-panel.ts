import { distinctUntilChanged, map, type Subscription } from "rxjs";
import { Popup } from "../../../lib/store/popup.ts";
import { Reactive } from "../../../lib/store/reactive.ts";

/**
 * Список «ждут ответа» открыт или нет, и сколько сейчас времени: «сколько ждёт» стареет само,
 * и пока список открыт, время перерисовывается раз в минуту.
 */
export class TurnsPanel extends Reactive {
  readonly popup = new Popup();
  private readonly clock = this.state(Date.now());
  private stop: Subscription | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    super();
    this.depend(this.popup);
  }

  get now(): number {
    return this.clock.value;
  }

  /** Пункт взят: список закрывается, директива открывается. */
  take<T>(turn: T, turns: { take(turn: T): void }): void {
    this.popup.close();
    turns.take(turn);
  }

  private tick(): void {
    this.clock.set(Date.now());
  }

  mount(): void {
    this.popup.mount();
    // `changed$` стора отвечает сразу при подписке: открытый список начинает тикать с порога.
    this.stop = this.popup.changed$
      .pipe(
        map(() => this.popup.open),
        distinctUntilChanged(),
      )
      .subscribe((open) => {
        this.halt();
        if (!open) return;
        this.tick();
        this.timer = setInterval(() => this.tick(), 60_000);
      });
  }

  unmount(): void {
    this.popup.unmount();
    this.stop?.unsubscribe();
    this.halt();
  }

  private halt(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
