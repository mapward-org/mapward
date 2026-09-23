import type { ReactNode } from "react";

/**
 * Список директив — один и тот же в двух местах: незакрытые под названием объекта и все
 * в мета-экране (решение 0024). Чем они отличаются, решает вызывающий: что дать списком
 * и можно ли отсюда удалять.
 *
 * На первом экране список прокручивается после пяти строк — решение 0028. Это не потолок:
 * в списке остаются все, и видно, что их больше, — просто экран под ними не съедается.
 * В мета-экране высота не режется: там прокручивается он сам.
 */
export function DirectiveList(props: {
  /** Список на первом экране: пять строк и прокрутка. */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col ${props.compact ? "max-h-[7.5rem] overflow-y-auto" : ""}`}>
      {props.children}
    </div>
  );
}

/** Что написать вместо пустого списка. */
export function DirectiveEmpty(props: { text: string }) {
  return <p className="px-3 py-0.5 text-[11px] opacity-50">{props.text}</p>;
}
