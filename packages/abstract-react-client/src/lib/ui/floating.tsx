import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Меню поверх всего — порталом в `body`, в месте, измеренном по кнопке (`Anchor`). Меню шапки
 * карточки иначе обрезалось бы её рамкой и прокруткой, а `fixed` внутри холста карты детей не
 * спасает: у холста `transform`, и `fixed` под ним ведёт себя как `absolute`.
 *
 * Клик в меню — не клик «мимо»: элемент отдаётся `hold` (`Popup.holdLayer`). Без документа
 * (первый кадр на сервере) меню не рисуется — оно и так закрыто.
 */
export function Floating(props: {
  at: { top: number; right: number };
  hold: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={props.hold}
      style={{ position: "fixed", top: props.at.top, right: props.at.right }}
      className="z-[1000] text-[var(--mw-foreground)]"
    >
      {props.children}
    </div>,
    document.body,
  );
}
