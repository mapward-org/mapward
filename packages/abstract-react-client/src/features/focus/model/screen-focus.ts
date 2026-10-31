import { EMPTY, filter, map as mapStream, startWith, switchMap, take } from "rxjs";
import type { Watchable } from "../../../lib/store/reactive.ts";

type Target = { address: string; run?: string };
type Inbox = Watchable & { pendingFor(mapPath: string): Target | undefined; take(): void };
/** Что фокусу нужно от карты: есть ли объект и его ресурс — ждать, пока придёт. */
type Map = { has(address: string): boolean; feed(address: string): Watchable };
type Screen = {
  object: { address: string };
  go(address: string): void;
  openRuns(run?: string): void;
};

/**
 * Переход экрана карты по просьбе хоста — кнопка «к объекту» в файле директивы. Выполняется,
 * когда объект пришёл с сервера: до ответа его ещё нет, и просьба ждёт, а не пропадает. Пока
 * ждёт, фокус подписан на ресурс объекта — без подписки объект и не пришёл бы.
 * Переход — обычный шаг, как клик по объекту: «назад» вернёт, где был.
 */
export class ScreenFocus {
  private stop: (() => void) | undefined;

  constructor(
    private readonly inbox: Inbox | undefined,
    private readonly mapPath: string,
    private readonly map: Map,
    private readonly screen: Screen,
  ) {}

  /** С прогоном — ещё и экран прогонов с ним: туда ведёт пункт экшона в ленте. */
  private go(target: Target): void {
    this.inbox?.take();
    if (this.screen.object.address !== target.address) this.screen.go(target.address);
    if (target.run !== undefined) this.screen.openRuns(target.run);
  }

  mount(): void {
    const inbox = this.inbox;
    if (!inbox) return;
    // Каждое изменение ящика — заново: есть ли просьба к этой карте. Есть — ждём её объект:
    // проверяем сразу и на каждое изменение его ресурса, переходим один раз.
    const subscription = inbox.changed$
      .pipe(
        mapStream(() => inbox.pendingFor(this.mapPath)),
        switchMap((target) =>
          target === undefined
            ? EMPTY
            : this.map.feed(target.address).changed$.pipe(
                startWith(undefined),
                filter(() => this.map.has(target.address)),
                take(1),
                mapStream(() => target),
              ),
        ),
      )
      .subscribe((target) => this.go(target));
    this.stop = () => subscription.unsubscribe();
  }

  unmount(): void {
    this.stop?.();
    this.stop = undefined;
  }
}
