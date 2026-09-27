import type { ReactNode } from "react";
import type { MetricGroup } from "@mapward/core";
import { tabHover } from "../../../lib/ui/tab-hover.ts";

const LINE = "border-[var(--mw-panel-border,#8884)]";

/** Затенение края поверх вкладок — цветом фона вида, клики проходят насквозь. */
const FADE =
  "pointer-events-none absolute top-0 bottom-px w-6 from-[var(--mw-sideBar-background)] to-transparent";

/**
 * Вкладки объекта — решение 0025, рамкой папки — 0045: под рядом общая линия, у открытой рамка
 * сверху и по бокам, а под ней линия прервана, и вкладка переходит в метрики. Линию рисуют края
 * ряда и закрытые вкладки, открытая — нет.
 *
 * Переключение вкладки перезапускает подписку: закрытая вкладка ничего не считает, поэтому
 * вкладка — это не фильтр вида, а то, что вообще открыто.
 *
 * Ряд один и прокручивается вбок: на двух строках рамка папки ломается, а прятать часть
 * вкладок за «ещё» значило бы прятать половину метрик объекта. Полосы прокрутки нет — что
 * вкладки уходят за край, говорит затенение этого края.
 */
export function GroupTabs(props: {
  hold: (element: HTMLElement | null) => void;
  moreLeft: boolean;
  moreRight: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative flex shrink-0">
      <div
        ref={props.hold}
        className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden pt-1 text-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <span className={`w-2 shrink-0 border-b ${LINE}`} />
        {props.children}
        <span className={`min-w-2 flex-1 border-b ${LINE}`} />
      </div>
      {props.moreLeft && <span className={`${FADE} left-0 bg-gradient-to-r`} />}
      {props.moreRight && <span className={`${FADE} right-0 bg-gradient-to-l`} />}
    </div>
  );
}

export function GroupTab(props: {
  group: MetricGroup;
  active: boolean;
  onSelect: (key: string) => void;
  /**
   * Ctrl + клик — открыть вкладку отдельным табом (0026). Иконки нет, под ctrl вкладка
   * подчёркивается (0035). Хост не умеет табов — нет и жеста.
   */
  onOpenTab?: ((key: string) => void) | undefined;
}) {
  const { group, active } = props;
  return (
    <button
      type="button"
      title={group.label ?? group.key}
      {...(active ? { "data-active": "" } : {})}
      onClick={(event) =>
        event.ctrlKey || event.metaKey ? props.onOpenTab?.(group.key) : props.onSelect(group.key)
      }
      className={`shrink-0 whitespace-nowrap rounded-t-sm px-2 py-0.5 ${LINE} ${
        active ? "border border-b-0 opacity-100" : "border-b opacity-60 hover:opacity-100"
      } ${props.onOpenTab ? tabHover.tabOnly : ""}`}
    >
      {group.label ?? group.key}
    </button>
  );
}
