import { useState, type ReactNode } from "react";
import { tabHover } from "./tab-modifier.ts";

/** Куда ведёт стрелка: объект по ту сторону шага истории. Идти некуда — стрелки нет. */
export type Arrow = { name: string; address: string; go: () => void };

/**
 * `trail` — предки-объекты текущего объекта, от корня и без него самого: он написан заголовком
 * рядом. Групп в списке не бывает — их отсеивает `breadcrumbTrail`, иначе крошка вела бы в
 * папку, за которой объекта нет.
 *
 * Стрелки — назад и вперёд по истории вида, а не к родителю: к родителю ведёт последняя крошка
 * (решение 0036). Рядом с ними — «перечитать», как в браузере (решение 0041): карта следит за
 * собой сама, а кнопка для того, что вотчер пропустил. Видны всегда, даже на корне: пропадая, они сдвигали бы крошки при каждом
 * переходе, поэтому когда идти некуда, стрелка гаснет.
 *
 * `views` — вкладки видов объекта, сразу за стрелками и до крошек: так они стоят на одном месте
 * на любом объекте, а длинные крошки переносятся после них. Что это за вкладки, строка не знает —
 * их передают готовыми, как стрелки. Приглушены только крошки: открытая вкладка не должна
 * выглядеть погасшей.
 */
export function Breadcrumbs(props: {
  trail: { address: string; name: string }[];
  onGo: (address: string) => void;
  back?: Arrow | undefined;
  forward?: Arrow | undefined;
  /** Предок открывается и отдельным табом: ctrl + клик — решение 0026, без иконки — 0035. */
  onOpenTab?: (address: string) => void;
  /** Перечитать карту; пока идёт — кнопка гаснет, чтобы второй клик не заводил второго. */
  onReload?: () => Promise<void>;
  views?: ReactNode;
}) {
  const tab = props.onOpenTab;
  const [reloading, setReloading] = useState(false);
  const reload = props.onReload;
  const arrow = (target: Arrow | undefined, sign: string, label: string) => (
    <button
      type="button"
      disabled={!target}
      title={target ? `${label}: ${target.name}` : label}
      onClick={(event) =>
        target && (tab && (event.ctrlKey || event.metaKey) ? tab(target.address) : target.go())
      }
      className="rounded-sm px-1 text-[16px] leading-none opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {sign}
    </button>
  );
  return (
    <nav className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1 text-[11px]">
      <span className="flex items-center pr-1">
        {arrow(props.back, "←", "Назад")}
        {arrow(props.forward, "→", "Вперёд")}
        {reload && (
          <button
            type="button"
            disabled={reloading}
            title="Перечитать карту"
            onClick={() => {
              setReloading(true);
              void reload().finally(() => setReloading(false));
            }}
            className="rounded-sm px-1 text-[14px] leading-none opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ↻
          </button>
        )}
      </span>
      {props.views !== undefined && <span className="flex items-center pr-1">{props.views}</span>}
      {props.trail.map((step, index) => (
        <span key={step.address} className="flex items-center gap-1 opacity-70">
          {index > 0 && <span className="opacity-50">/</span>}
          <button
            type="button"
            onClick={(event) =>
              tab && (event.ctrlKey || event.metaKey) ? tab(step.address) : props.onGo(step.address)
            }
            {...(tab === undefined ? {} : { title: "Ctrl + клик — открыть отдельным табом" })}
            className={tab ? tabHover.tabLink : "hover:underline"}
          >
            {step.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
