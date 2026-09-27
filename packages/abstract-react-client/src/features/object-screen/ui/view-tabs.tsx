import { MetaIcon, MetricsIcon, RunsIcon } from "../../../lib/ui/icons.tsx";

/** Три вида одного объекта: что показывают метрики, как он устроен и что на нём запускали. */
export type ObjectView = "metrics" | "meta" | "runs";

/**
 * Виды объекта — иконками в строке истории, за стрелками (решение 0045): открытый подсвечен
 * фоном, подпись — подсказкой. Переключают в один клик из любого вида в любой.
 */
const TABS = [
  { key: "metrics", label: "метрики", icon: MetricsIcon },
  { key: "meta", label: "об объекте", icon: MetaIcon },
  { key: "runs", label: "прогоны", icon: RunsIcon },
] as const;

export function ViewTabs(props: { active: ObjectView; onSelect: (view: ObjectView) => void }) {
  return (
    <div className="flex gap-0.5">
      {TABS.map((tab) => {
        const active = tab.key === props.active;
        return (
          <button
            key={tab.key}
            type="button"
            title={tab.label}
            aria-label={tab.label}
            aria-pressed={active}
            onClick={() => props.onSelect(tab.key)}
            className={`flex items-center rounded-sm p-0.5 ${
              active
                ? "bg-[var(--mw-list-activeSelectionBackground,#8883)] opacity-100"
                : "opacity-60 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
            }`}
          >
            <span className="flex size-4 items-center justify-center">{tab.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
