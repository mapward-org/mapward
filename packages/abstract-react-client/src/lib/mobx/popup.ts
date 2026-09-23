import { action, makeObservable, observable, reaction, observableRef } from "mobx";

/**
 * Открытое меню или список — локальный стор отображения (решение 0042). Клик мимо закрывает:
 * одно и то же у меню строки, меню шапки и списка «ждут ответа». Элемент, внутри которого клик
 * не считается «мимо», вид отдаёт `ref={popup.hold}`.
 */
export class Popup {
  open = false;
  private element: HTMLElement | null = null;
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
    makeObservable(this, { open: observable, show: action, close: action, toggle: action });
  }

  /** Куда смотреть, мимо ли клик. */
  readonly hold = (element: HTMLElement | null) => {
    this.element = element;
  };

  show(): void {
    this.open = true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.onClose?.();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  mount(): void {
    this.stop = reaction(
      () => this.open,
      (open) => (open ? this.listen() : this.unlisten()),
      { fireImmediately: true },
    );
  }

  unmount(): void {
    this.stop?.();
    this.unlisten();
  }

  private listen(): void {
    const away = (event: MouseEvent) => {
      if (!this.element?.contains(event.target as Node)) this.close();
    };
    const close = () => this.close();
    document.addEventListener("mousedown", away);
    if (this.fixed) {
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }
    this.listening = () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }

  private unlisten(): void {
    this.listening?.();
    this.listening = undefined;
  }
}

/** Раскрыто ли: раздел, секция аккордеона. Состояние интерфейса, никуда не сохраняется. */
export class Toggle {
  open: boolean;

  constructor(initial: boolean) {
    this.open = initial;
    makeObservable(this, { open: observable, flip: action, set: action });
  }

  flip(): void {
    this.open = !this.open;
  }

  set(open: boolean): void {
    this.open = open;
  }
}

/** Где показать меню, лежащее `fixed`: меряется по кнопке в момент открытия. */
export class Anchor {
  at = { top: 0, right: 0 };

  constructor() {
    makeObservable(this, { at: observableRef, measure: action });
  }

  measure(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    this.at = { top: rect.bottom + 2, right: window.innerWidth - rect.right };
  }
}
