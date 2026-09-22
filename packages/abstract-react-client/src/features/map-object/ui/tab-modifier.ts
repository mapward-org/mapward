import { useEffect } from "react";

/**
 * Пока зажат ctrl (cmd на маке), на `html` стоит `data-tab-mod`, и подсвечивается то, что
 * откроется отдельным табом, — как ссылки в редакторе VS Code. Иконки у ссылок нет (решение 0035),
 * поэтому видно жест только так.
 *
 * Модификатор читается и с мыши: вебвью без фокуса нажатий не получает, а mousemove несёт
 * `ctrlKey` всегда. Уход окна снимает атрибут — иначе ctrl «залипнет» после alt + tab.
 * Хост без табов хук не включает: подсветка обещала бы то, чего не будет (решение 0014).
 */
export function useTabModifier(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const set = (held: boolean) =>
      held ? root.setAttribute("data-tab-mod", "") : root.removeAttribute("data-tab-mod");
    const follow = (event: KeyboardEvent | MouseEvent) => set(event.ctrlKey || event.metaKey);
    const release = () => set(false);
    window.addEventListener("keydown", follow);
    window.addEventListener("keyup", follow);
    window.addEventListener("mousemove", follow);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", follow);
      window.removeEventListener("keyup", follow);
      window.removeEventListener("mousemove", follow);
      window.removeEventListener("blur", release);
      release();
    };
  }, [enabled]);
}

/**
 * Классы подсветки. Строки целиком, а не склейкой: tailwind находит классы по тексту исходника.
 *
 * - `tabLink` — ссылка, которая откроется табом: подчёркнута на ховере всегда, под ctrl — ещё и рука;
 * - `plainLink` — ссылка, которая табом не откроется (файл, наружу): под ctrl подчёркивание теряет;
 * - `tabOnly` — то, что ссылкой не выглядит (вкладка, узел карты, заголовок метрики): подчёркнуто
 *   только под ctrl.
 */
export const tabHover = {
  tabLink: "hover:underline in-data-[tab-mod]:hover:cursor-pointer",
  plainLink: "not-in-data-[tab-mod]:hover:underline",
  tabOnly: "in-data-[tab-mod]:hover:underline in-data-[tab-mod]:hover:cursor-pointer",
};
