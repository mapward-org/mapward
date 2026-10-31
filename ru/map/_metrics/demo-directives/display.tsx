import { useState } from "react";
import type { MetricProps } from "@mapward/component";
import { useNavigation, usePlugin, useStream } from "@mapward/component";
import type shell from "../../_plugins/shell/index.ts";
import { List } from "../../_plugins/views/bricks/list.tsx";

type Directive = {
  name: string;
  object: string;
  file: string;
  status: "open" | "done";
  stage: string | null;
  runs: number;
};

type Params = { command: string; env?: Record<string, string> };

/**
 * Тестовая метрика-компонент (решение 0037): плитки с числами, полосы по этапам и список
 * открытых директив под переключателем. Данные — вывод скрипта через `shell.json`. Проверяет хук
 * на React карты и произвольные классы tailwind.
 */
export default function Directives({ params }: MetricProps<Params>) {
  const plugin = usePlugin<typeof shell>("../../_plugins/shell");
  const answer = useStream(["shell.json", params], () => plugin.json(params));
  const [showDone, setShowDone] = useState(false);
  const navigate = useNavigation();

  if (answer.status === "error") {
    return <div className="text-[var(--mw-errorForeground)]">{answer.error}</div>;
  }
  const all = (answer.last as { directives?: Directive[] } | undefined)?.directives;
  if (!all) return <div className="text-[var(--mw-descriptionForeground)]">загружается…</div>;
  const openOnes = all.filter((directive) => directive.status === "open");
  const done = all.length - openOnes.length;

  const byStage = new Map<string, number>();
  for (const directive of openOnes) {
    const stage = directive.stage ?? "не начата";
    byStage.set(stage, (byStage.get(stage) ?? 0) + 1);
  }
  const widest = Math.max(1, ...byStage.values());
  const shown = showDone ? all : openOnes;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
        <Tile label="всего" value={all.length} />
        <Tile label="в работе" value={openOnes.length} accent />
        <Tile label="выполнено" value={done} />
      </div>

      <div className="flex flex-col gap-1">
        {[...byStage.entries()].map(([stage, count]) => (
          <div
            key={stage}
            className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-[11px]"
          >
            <span className="truncate opacity-80">{stage}</span>
            <span className="h-2 rounded-sm bg-[var(--mw-input-background)]">
              <span
                className="block h-2 rounded-sm bg-[var(--mw-textLink-foreground)]"
                style={{ width: `${(count / widest) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums">{count}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowDone(!showDone)}
        className="self-start rounded border border-[var(--mw-panel-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--mw-list-hoverBackground)]"
      >
        {showDone ? "только в работе" : "показать и выполненные"}
      </button>

      <List
        items={shown.map((directive) => ({
          label: directive.name,
          link: directive.file,
          status: directive.status === "done" ? "success" : "pending",
          description: `${directive.stage ?? "не начата"} · кругов ${directive.runs}`,
          // Кнопка справа у строки, ссылка — на самой строке (решение 0038).
          action: { run: "reveal", inputs: { path: directive.file } },
        }))}
        empty="нет директив в работе"
        onClick={navigate}
      />

      <button
        type="button"
        onClick={() => navigate("mapward://")}
        className="self-start text-[11px] text-[var(--mw-textLink-foreground)] hover:underline"
      >
        на корень карты
      </button>
    </div>
  );
}

function Tile(props: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center rounded border border-[var(--mw-panel-border)] py-2">
      <span
        className={`text-xl font-semibold tabular-nums ${
          props.accent ? "text-[var(--mw-textLink-foreground)]" : ""
        }`}
      >
        {props.value}
      </span>
      <span className="text-[11px] opacity-70">{props.label}</span>
    </div>
  );
}
