import { reaction } from "mobx";

type Inbox = { pendingFor(mapPath: string): string | undefined; take(): void };
type Map = { has(address: string): boolean };
type Screen = { object: { address: string }; go(address: string): void };

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

  /** Адрес, к которому пора перейти: просьба есть и объект уже в карте. */
  private ready(): string | undefined {
    const address = this.inbox?.pendingFor(this.mapPath);
    return address !== undefined && this.map.has(address) ? address : undefined;
  }

  private go(address: string | undefined): void {
    if (address === undefined) return;
    this.inbox?.take();
    if (this.screen.object.address !== address) this.screen.go(address);
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
