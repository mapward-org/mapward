import { MetaIcon, MetricsIcon, RunsIcon } from "../../../lib/ui/icons.tsx";

/** Три вида одного объекта: что показывают метрики, как он устроен и что на нём запускали. */
export type ObjectView = "metrics" | "meta" | "runs";

/**
 * Мини-вкладки видов объекта. Раньше их переключали две кнопки в шапке, каждая со своим «туда и
 * обратно», и где ты сейчас, было видно только по иконке на кнопке. Вкладки говорят это сразу и
 * переключают в один клик из любого вида в любой. Своей строки у них нет: они стоят в строке
 * истории, за стрелками.
 */
const TABS = [
  { key: "metrics", label: "метрики", icon: MetricsIcon },
  { key: "meta", label: "об объекте", icon: MetaIcon },
  { key: "runs", label: "прогоны", icon: RunsIcon },
] as const;

export function ViewTabs(props: { active: ObjectView; onSelect: (view: ObjectView) => void }) {
  return (
    <div className="flex gap-1">
      {TABS.map((tab) => {
        const active = tab.key === props.active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => props.onSelect(tab.key)}
            className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] ${
              active
                ? "bg-[var(--mw-list-activeSelectionBackground,#8883)] opacity-100"
                : "opacity-60 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
            }`}
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
