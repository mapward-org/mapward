import { useCallback, useEffect, useRef, useState } from "react";
import type { Turn } from "@mapward/core";
import { useDismiss } from "../../../lib/ui/row-menu.tsx";
import { badge, turnLabel, waited } from "../pure-model/turns.ts";

/**
 * Кнопка с числом внизу сайдбара, поверх карты, и список над ней — решение 0034. Не всплывашка:
 * она не отвлекает, пока человек думает о другом, а ждёт, когда он сам посмотрит.
 *
 * Список открывается кликом, не наведением, как остальные меню карты (решение 0028). Пустой
 * список — кнопки нет: иначе она висела бы поверх карты всегда.
 */
export function TurnsButton(props: { turns: Turn[]; onTake: (turn: Turn) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);

  // «Сколько ждёт» стареет само: список открыт — время перерисовывается раз в минуту.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [open]);

  const { turns } = props;
  if (turns.length === 0) return null;

  return (
    <div ref={box} className="fixed right-3 bottom-3 z-40 flex flex-col items-end gap-1">
      {open && (
        <div className="flex max-h-[60vh] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg">
          <div className="px-3 py-0.5 text-[11px] text-[var(--mw-descriptionForeground)]">
            Ждут ответа
          </div>
          {turns.map((turn) => (
            <button
              key={`${turn.mapPath}\n${turn.address}\n${turn.directive}`}
              type="button"
              title={turn.path}
              onClick={() => {
                close();
                props.onTake(turn);
              }}
              className="flex w-full items-baseline gap-2 px-3 py-0.5 text-left text-[11px] hover:bg-[var(--mw-list-hoverBackground)]"
            >
              <span className="min-w-0 flex-1 truncate opacity-90">{turnLabel(turn)}</span>
              <span className="shrink-0 text-[var(--mw-descriptionForeground)]">
                {waited(turn.at, now)}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        title={`Ждут ответа: ${turns.length}`}
        onClick={() => setOpen(!open)}
        className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--mw-badge-background,var(--mw-button-background))] px-2 text-[12px] font-semibold text-[var(--mw-badge-foreground,var(--mw-button-foreground))] shadow-lg hover:opacity-90"
      >
        {badge(turns.length)}
      </button>
    </div>
  );
}
