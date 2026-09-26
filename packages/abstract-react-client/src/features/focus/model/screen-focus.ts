import { reaction } from "mobx";

type Target = { address: string; run?: string };
type Inbox = { pendingFor(mapPath: string): Target | undefined; take(): void };
type Map = { has(address: string): boolean };
type Screen = {
  object: { address: string };
  go(address: string): void;
  openRuns(run?: string): void;
};

/**
 * Переход экрана карты по просьбе хоста — кнопка «к объекту» в файле директивы. Выполняется,
 * когда объект есть в карте: до загрузки карты его ещё нет, и просьба ждёт, а не пропадает.
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

  /** Куда пора перейти: просьба есть и объект уже в карте. */
  private ready(): Target | undefined {
    const target = this.inbox?.pendingFor(this.mapPath);
    return target !== undefined && this.map.has(target.address) ? target : undefined;
  }

  /** С прогоном — ещё и экран прогонов с ним: туда ведёт пункт экшона в ленте. */
  private go(target: Target | undefined): void {
    if (target === undefined) return;
    this.inbox?.take();
    if (this.screen.object.address !== target.address) this.screen.go(target.address);
    if (target.run !== undefined) this.screen.openRuns(target.run);
  }

  mount(): void {
    if (!this.inbox) return;
    this.stop = reaction(
      () => this.ready(),
      (address) => this.go(address),
      { fireImmediately: true },
    );
  }

  unmount(): void {
    this.stop?.();
    this.stop = undefined;
  }
}
