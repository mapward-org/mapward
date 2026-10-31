import { Reactive, type State } from "./reactive.ts";

/**
 * Открытое меню или список — локальный стор отображения (решение 0042). Клик мимо закрывает:
 * одно и то же у меню строки, меню шапки и списка «ждут ответа». Элемент, внутри которого клик
 * не считается «мимо», вид отдаёт `ref={popup.hold}`.
 */
export class Popup extends Reactive {
  private readonly opened = this.state(false);
  private element: HTMLElement | null = null;
  /** Меню, вынесенное порталом из-под кнопки: клик в нём — не «мимо». */
  private layer: HTMLElement | null = null;
  private stop: (() => void) | undefined;
  private listening: (() => void) | undefined;

  constructor(
    private readonly onClose?: () => void,
    /**
     * Закрываться от прокрутки и смены размера: меню, лежащее `fixed`, иначе уехало бы от
     * строки, из которой открыто.
     */
    private readonly fixed = false,
  ) {
    super();
  }

  get open(): boolean {
    return this.opened.value;
  }

  /** Куда смотреть, мимо ли клик. */
  readonly hold = (element: HTMLElement | null) => {
    this.element = element;
  };

  /** То же для меню, которое лежит порталом поверх всего: в DOM оно не внутри кнопки. */
  readonly holdLayer = (element: HTMLElement | null) => {
    this.layer = element;
  };

  private inside(target: EventTarget | null): boolean {
    const node = target as Node | null;
    return Boolean(node && (this.element?.contains(node) || this.layer?.contains(node)));
  }

  show(): void {
    this.opened.set(true);
  }

  close(): void {
    if (!this.open) return;
    this.opened.set(false);
    this.onClose?.();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  mount(): void {
    const subscription = this.opened.value$.subscribe((open) =>
      open ? this.listen() : this.unlisten(),
    );
    this.stop = () => subscription.unsubscribe();
  }

  unmount(): void {
    this.stop?.();
    this.unlisten();
  }

  private listen(): void {
    const away = (event: Event) => {
      if (!this.inside(event.target)) this.close();
    };
    const close = () => this.close();
    document.addEventListener("mousedown", away);
    // Меню `fixed` стоит там, где была кнопка: прокрутка вокруг или колесо над холстом увели
    // бы кнопку из-под него. Прокрутка самого меню — не повод закрываться.
    if (this.fixed) {
      window.addEventListener("scroll", away, true);
      window.addEventListener("wheel", away, true);
      window.addEventListener("resize", close);
    }
    this.listening = () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("wheel", away, true);
      window.removeEventListener("resize", close);
    };
  }

  private unlisten(): void {
    this.listening?.();
    this.listening = undefined;
  }
}

/** Раскрыто ли: раздел, секция аккордеона. Состояние интерфейса, никуда не сохраняется. */
export class Toggle extends Reactive {
  private readonly opened: State<boolean>;

  constructor(initial: boolean) {
    super();
    this.opened = this.state(initial);
  }

  get open(): boolean {
    return this.opened.value;
  }

  flip(): void {
    this.opened.set(!this.open);
  }

  set(open: boolean): void {
    this.opened.set(open);
  }
}

/** Где показать меню, лежащее `fixed`: меряется по кнопке в момент открытия. */
export class Anchor extends Reactive {
  private readonly place = this.state({ top: 0, right: 0 });

  get at(): { top: number; right: number } {
    return this.place.value;
  }

  measure(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    this.place.set({ top: rect.bottom + 2, right: window.innerWidth - rect.right });
  }

  /** Меню по правому клику встаёт там, где курсор, а не под кнопкой. */
  point(x: number, y: number): void {
    this.place.set({ top: y, right: window.innerWidth - x });
  }
}
