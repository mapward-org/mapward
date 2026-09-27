import { action, makeObservable, observable, reaction } from "mobx";

/**
 * Ряд вкладок объекта — один и прокручивается вбок (решение 0045): вкладки-папки на двух
 * строках ломаются. Поэтому открытая вкладка сама встаёт в видимую часть ряда — при открытии
 * объекта и при любом переключении, в том числе по истории, — а колесо над рядом крутит его
 * вбок: вертикальной прокрутки у ряда нет, и колесо иначе ничего бы не делало.
 *
 * Полосы прокрутки у ряда нет: что вкладки уходят за край, показывает затенение этого края, и
 * ряд знает, у какого края оно нужно.
 *
 * Открытую вкладку ряд находит по `data-active` — ставит её вид.
 */
export class TabsRow {
  /** Вкладки уходят за левый и правый край — там затенение. */
  moreLeft = false;
  moreRight = false;
  private element: HTMLElement | null = null;
  private stop: (() => void) | undefined;
  private readonly resize =
    typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => this.measure());

  constructor(private readonly active: () => string | undefined) {
    makeObservable<TabsRow, "measure">(this, {
      moreLeft: observable,
      moreRight: observable,
      measure: action,
    });
  }

  /** Ряд приходит и уходит вместе с видом метрик — `ref={row.hold}`. */
  readonly hold = (element: HTMLElement | null) => {
    this.element?.removeEventListener("wheel", this.wheel);
    this.element?.removeEventListener("scroll", this.scroll);
    this.resize?.disconnect();
    this.element = element;
    element?.addEventListener("wheel", this.wheel, { passive: false });
    element?.addEventListener("scroll", this.scroll, { passive: true });
    if (element) this.resize?.observe(element);
    this.reveal();
    this.measure();
  };

  private readonly scroll = () => this.measure();

  private measure(): void {
    const row = this.element;
    // Пиксель запаса: дробная ширина при масштабе окна не должна давать вечное затенение.
    this.moreLeft = row !== null && row.scrollLeft > 1;
    this.moreRight = row !== null && row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
  }

  private readonly wheel = (event: WheelEvent) => {
    const row = this.element;
    if (!row || event.deltaY === 0 || row.scrollWidth <= row.clientWidth) return;
    event.preventDefault();
    row.scrollLeft += event.deltaY;
  };

  private reveal(): void {
    this.element
      ?.querySelector<HTMLElement>("[data-active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  mount(): void {
    // Вкладка сменилась в сторе, а `data-active` вид переставит только на своей перерисовке —
    // поэтому ищем её кадром позже.
    this.stop = reaction(this.active, () => requestAnimationFrame(() => this.reveal()), {
      fireImmediately: true,
    });
    // Снятие отключило слежку за размером, а ряд остался тем же — ref второй раз не придёт.
    if (this.element) this.resize?.observe(this.element);
  }

  unmount(): void {
    this.stop?.();
    this.resize?.disconnect();
  }
}
