import type { ReactNode } from "react";

/**
 * Список директив мета-экрана — все, со старыми. Высота не режется: прокручивается сам экран.
 * Незакрытые живут в меню на кнопке шапки (решение 0045).
 */
export function DirectiveList(props: { children: ReactNode }) {
  return <div className="flex flex-col">{props.children}</div>;
}
