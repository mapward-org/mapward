import { useState } from "react";
import type { MetricProps } from "@mapward/component";
import { useNavigation, usePlugin, useStream } from "@mapward/component";
import type shell from "../../_plugins/shell/index.ts";
import { ActionButton } from "../../_plugins/views/bricks/action-button.tsx";
import { StatusDot } from "../../_plugins/views/bricks/status-dot.tsx";

type Decision = { number: string; title: string; file: string; draft: boolean };

/**
 * Тестовая метрика-компонент (решение 0037): решения карточками с поиском. Данные — вывод
 * скрипта через `shell.json`, команда — в `params`. Проверяет ввод с состоянием, сетку на
 * произвольных колонках и `useNavigation` у своей кнопки.
 */
export default function Decisions({ params, metric }: MetricProps<{ command: string }>) {
  const plugin = usePlugin<typeof shell>("../../_plugins/shell");
  const answer = useStream(["shell.json", params.command], () =>
    plugin.json({ command: params.command }),
  );
  const [query, setQuery] = useState("");
  const open = useNavigation();

  if (answer.status === "error") {
    return <div className="text-[var(--mw-errorForeground)]">{answer.error}</div>;
  }
  const data = answer.last as { decisions?: Decision[] } | undefined;
  if (!data?.decisions) {
    return <div className="text-[var(--mw-descriptionForeground)]">{metric.label}: загружается…</div>;
  }
  const decisions = data.decisions;
  const wanted = query.trim().toLowerCase();
  const found = decisions.filter(
    (decision) =>
      wanted === "" ||
      decision.number.includes(wanted) ||
      decision.title.toLowerCase().includes(wanted),
  );
  const drafts = decisions.filter((decision) => decision.draft).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="номер или слово из заголовка"
          className="min-w-0 flex-1 rounded border border-[var(--mw-input-border,transparent)] bg-[var(--mw-input-background)] px-2 py-0.5 text-[var(--mw-input-foreground)] outline-none focus:border-[var(--mw-focusBorder)]"
        />
        <span className="shrink-0 text-[11px] opacity-70">
          {found.length} из {decisions.length}, черновиков {drafts}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {found.map((decision) => (
          <div
            key={decision.number}
            className="flex flex-col items-start gap-1 rounded border border-[var(--mw-panel-border)] p-2"
          >
            <button
              type="button"
              onClick={() => open(decision.file)}
              className="flex w-full flex-col items-start gap-1 text-left hover:underline"
            >
              <span className="flex items-center gap-1 text-[11px] opacity-70">
                <StatusDot
                  status={decision.draft ? "pending" : "success"}
                  hint={decision.draft ? "черновик агента" : "принято"}
                />
                {decision.number}
              </span>
              <span className="line-clamp-2">{decision.title}</span>
            </button>
            {/* Кнопка экшона корня — решение 0038: запуск тем же путём, что кнопка в шапке. */}
            <ActionButton
              action="reveal"
              inputs={{ path: decision.file }}
              label="показать в проводнике"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
