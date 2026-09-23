import type { ReactNode } from "react";
import { tabHover } from "../../../lib/ui/tab-hover.ts";

/** Куда ведёт стрелка: объект по ту сторону шага истории. Идти некуда — стрелки нет. */
export type Arrow = { name: string; address: string; go: () => void };

/** Ctrl + клик открывает отдельным табом — решение 0026, без иконки — 0035. */
const withTab = (event: { ctrlKey: boolean; metaKey: boolean }) => event.ctrlKey || event.metaKey;

const BUTTON =
  "rounded-sm px-1 leading-none opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Строка истории: стрелки, «перечитать», вкладки видов и крошки — их кладут внутрь готовыми.
 *
 * Стрелки — назад и вперёд по истории вида, а не к родителю: к родителю ведёт последняя крошка
 * (решение 0036). Видны всегда, даже на корне: пропадая, они сдвигали бы крошки при каждом
 * переходе, поэтому когда идти некуда, стрелка гаснет.
 *
 * Вкладки видов — сразу за стрелками и до крошек: так они стоят на одном месте на любом
 * объекте, а длинные крошки переносятся после них.
 */
export function CrumbsBar(props: { children: ReactNode }) {
  return (
    <nav className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1 text-[11px]">
      {props.children}
    </nav>
  );
}

/** Кучка кнопок строки — стрелки с «перечитать» или вкладки видов. */
export function CrumbsGroup(props: { children: ReactNode }) {
  return <span className="flex items-center pr-1">{props.children}</span>;
}

export function HistoryArrow(props: {
  target: Arrow | undefined;
  sign: string;
  label: string;
  onOpenTab: ((address: string) => void) | undefined;
}) {
  const { target, onOpenTab } = props;
  return (
    <button
      type="button"
      disabled={!target}
      title={target ? `${props.label}: ${target.name}` : props.label}
      onClick={(event) =>
        target && (onOpenTab && withTab(event) ? onOpenTab(target.address) : target.go())
      }
      className={`${BUTTON} text-[16px]`}
    >
      {props.sign}
    </button>
  );
}

/**
 * «Перечитать», как в браузере (решение 0041): карта следит за собой сама, а кнопка для того,
 * что вотчер пропустил. Пока идёт — гаснет, чтобы второй клик не заводил второго.
 */
export function ReloadButton(props: { reloading: boolean; onReload: () => void }) {
  return (
    <button
      type="button"
      disabled={props.reloading}
      title="Перечитать карту"
      onClick={props.onReload}
      className={`${BUTTON} text-[14px]`}
    >
      ↻
    </button>
  );
}

/**
 * Крошка — предок-объект текущего объекта, от корня и без него самого: он написан заголовком
 * рядом. Групп в крошках не бывает — их отсеивает `breadcrumbTrail`. Приглушены только крошки:
 * открытая вкладка вида не должна выглядеть погасшей.
 */
export function Crumb(props: {
  step: { address: string; name: string };
  first: boolean;
  onGo: (address: string) => void;
  onOpenTab: ((address: string) => void) | undefined;
}) {
  const { step, onOpenTab } = props;
  return (
    <span className="flex items-center gap-1 opacity-70">
      {!props.first && <span className="opacity-50">/</span>}
      <button
        type="button"
        onClick={(event) =>
          onOpenTab && withTab(event) ? onOpenTab(step.address) : props.onGo(step.address)
        }
        {...(onOpenTab === undefined ? {} : { title: "Ctrl + клик — открыть отдельным табом" })}
        className={onOpenTab ? tabHover.tabLink : "hover:underline"}
      >
        {step.name}
      </button>
    </span>
  );
}
