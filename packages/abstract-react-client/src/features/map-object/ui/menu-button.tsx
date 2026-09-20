import { type ReactNode, useEffect, useRef, useState } from "react";
import { RemoveIcon } from "./icons.tsx";

/** A row of names is noise until you want it; behind a button it costs nothing. */
export function MenuButton(props: {
  title: string;
  icon: ReactNode;
  items: {
    key: string;
    label: string;
    /** Подробность, которой не место в строке: висит тултипом, как у кнопок шапки. */
    title?: string;
    hint?: string;
    hintClass?: string;
    onSelect: () => void;
    /** Ключ отдельно от подписи: у слоёв конфига подписи повторяются, файлы — нет. */
    runs?: { key?: string; label: string; onSelect: () => void }[];
    /** Крестик справа: убрать эту строку. Строка, которую убирать нечем, его не показывает. */
    onRemove?: () => void;
  }[];
  lead?: { label: string; onSelect: () => void };
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (props.items.length === 0 && !props.lead) return null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title={props.title}
        onClick={() => setOpen(!open)}
        className="rounded-sm px-1 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
      >
        {props.icon}
      </button>

      {open && (
        <ul className="absolute right-0 z-50 min-w-56 rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg">
          {props.lead && (
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.lead?.onSelect();
                }}
                className="block w-full px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
              >
                + {props.lead.label}
              </button>
            </li>
          )}
          {props.items.map((item) => (
            <li key={item.key} className="group/item relative">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                {...(item.title === undefined ? {} : { title: item.title })}
                className={`flex w-full items-center gap-2 py-0.5 pl-3 text-left hover:bg-[var(--mw-list-hoverBackground)] ${item.onRemove ? "pr-7" : "pr-3"}`}
              >
                <span className="truncate">{item.label}</span>
                {item.hint && (
                  <span className={`ml-auto shrink-0 ${item.hintClass ?? "opacity-60"}`}>
                    {item.hint}
                  </span>
                )}
              </button>
              {/*
                Крестик поверх строки, а не в ней: строка — кнопка целиком, и вложить в неё
                вторую нельзя. Показывается он на наведении — иначе список читался бы через
                ряд крестиков.
              */}
              {item.onRemove && (
                <button
                  type="button"
                  title="Удалить"
                  onClick={() => {
                    setOpen(false);
                    item.onRemove?.();
                  }}
                  className="absolute top-1 right-2 hidden opacity-60 group-hover/item:block hover:opacity-100"
                >
                  {RemoveIcon}
                </button>
              )}
              {item.runs && (
                <span className="hidden gap-2 px-3 pb-1 opacity-70 group-hover/item:flex">
                  {item.runs.map((run) => (
                    <button
                      key={run.key ?? run.label}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        run.onSelect();
                      }}
                      className="rounded-sm px-1 text-[11px] hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
                    >
                      {run.label}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
