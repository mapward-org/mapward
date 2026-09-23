import { reaction } from "mobx";

/**
 * Пока зажат ctrl (cmd на маке), на `html` стоит `data-tab-mod`, и подсвечивается то, что
 * откроется отдельным табом, — как ссылки в редакторе VS Code. Иконки у ссылок нет (решение 0035),
 * поэтому видно жест только так.
 *
 * Модификатор читается и с мыши: вебвью без фокуса нажатий не получает, а mousemove несёт
 * `ctrlKey` всегда. Уход окна снимает атрибут — иначе ctrl «залипнет» после alt + tab.
 * Хост без табов слежку не включает: подсветка обещала бы то, чего не будет (решение 0014).
 */
export class TabModifier {
  private stop: (() => void) | undefined;
  private listening: (() => void) | undefined;

  constructor(private readonly enabled: () => boolean) {}

  mount(): void {
    this.stop = reaction(this.enabled, (on) => (on ? this.listen() : this.unlisten()), {
      fireImmediately: true,
    });
  }

  unmount(): void {
    this.stop?.();
    this.unlisten();
  }

  private listen(): void {
    if (this.listening) return;
    const root = document.documentElement;
    const set = (held: boolean) =>
      held ? root.setAttribute("data-tab-mod", "") : root.removeAttribute("data-tab-mod");
    const follow = (event: KeyboardEvent | MouseEvent) => set(event.ctrlKey || event.metaKey);
    const release = () => set(false);
    window.addEventListener("keydown", follow);
    window.addEventListener("keyup", follow);
    window.addEventListener("mousemove", follow);
    window.addEventListener("blur", release);
    this.listening = () => {
      window.removeEventListener("keydown", follow);
      window.removeEventListener("keyup", follow);
      window.removeEventListener("mousemove", follow);
      window.removeEventListener("blur", release);
      release();
    };
  }

  private unlisten(): void {
    this.listening?.();
    this.listening = undefined;
  }
}
