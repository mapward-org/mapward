import type { MetricGroup } from "@mapward/core";
import { TabIcon } from "./icons.tsx";

/**
 * Вкладки объекта — решение 0025.
 *
 * Переключение вкладки перезапускает подписку: закрытая вкладка ничего не считает, поэтому
 * вкладка — это не фильтр вида, а то, что вообще открыто.
 *
 * Строк может быть несколько: вкладок бывает больше, чем влезает в ширину сайдбара, и прятать
 * часть из них за «ещё» значило бы прятать половину метрик объекта.
 */
export function GroupTabs(props: {
  groups: MetricGroup[];
  active: string;
  onSelect: (key: string) => void;
  /** Ctrl + клик и иконка — открыть вкладку отдельным табом (0026). Хост не умеет — нет их. */
  onOpenTab?: (key: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap gap-1 px-2 pb-1">
      {props.groups.map((group) => {
        const active = group.key === props.active;
        return (
          <span key={group.key} className="group/tab relative flex items-center">
            <button
              type="button"
              title={group.label ?? group.key}
              onClick={(event) =>
                event.ctrlKey || event.metaKey
                  ? props.onOpenTab?.(group.key)
                  : props.onSelect(group.key)
              }
              className={`rounded-sm px-1.5 py-0.5 text-[11px] ${
                active
                  ? "bg-[var(--mw-list-activeSelectionBackground,#8883)] opacity-100"
                  : "opacity-60 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
              } ${props.onOpenTab ? "pr-5" : ""}`}
            >
              {group.label ?? group.key}
            </button>

            {props.onOpenTab && (
              <button
                type="button"
                title="Открыть отдельным табом"
                onClick={() => props.onOpenTab?.(group.key)}
                className="absolute right-1 hidden opacity-60 group-hover/tab:block hover:opacity-100"
              >
                {TabIcon}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
