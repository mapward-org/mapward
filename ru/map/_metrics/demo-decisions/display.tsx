import { useState } from "react";
import type { DisplayProps } from "@mapward/display";
import { StatusDot } from "@mapward/display";
import type { Data } from "./display.data";

/**
 * Тестовый дисплей-компонент (решение 0037): решения карточками с поиском. Проверяет ввод с
 * состоянием, сетку на произвольных колонках и `open` у своей кнопки. Схема лежит объектом
 * прямо в `config.json`.
 */
export default function Display({ data, open }: DisplayProps<Data>) {
  const [query, setQuery] = useState("");
  const wanted = query.trim().toLowerCase();
  const found = data.decisions.filter(
    (decision) =>
      wanted === "" ||
      decision.number.includes(wanted) ||
      decision.title.toLowerCase().includes(wanted),
  );
  const drafts = data.decisions.filter((decision) => decision.draft).length;

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
          {found.length} из {data.decisions.length}, черновиков {drafts}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {found.map((decision) => (
          <button
            key={decision.number}
            type="button"
            onClick={() => open(decision.file)}
            className="flex flex-col items-start gap-1 rounded border border-[var(--mw-panel-border)] p-2 text-left hover:bg-[var(--mw-list-hoverBackground)]"
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
        ))}
      </div>
    </div>
  );
}
