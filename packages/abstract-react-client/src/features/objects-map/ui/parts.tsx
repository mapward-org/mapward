import type { ReactNode } from "react";

/**
 * Части вьюхи карты вокруг холста: рамка, боковая панель инструментов, строка сообщения,
 * подтверждение удаления и поповер. Маленькие вью без состояния — собирает их compose.
 */

const panel = {
  background: "var(--mw-editor-background)",
  borderColor: "var(--mw-panel-border, #8884)",
};

/** Рамка вьюхи: холст и всё, что лежит поверх него. */
export function MapFrame(props: { children: ReactNode }) {
  return <div className="relative h-full min-h-40 w-full">{props.children}</div>;
}

/** Боковая панель, как в Miro: что поставит следующий клик по холсту. */
export function ToolbarFrame(props: { children: ReactNode }) {
  return (
    <div
      className="absolute top-2 left-2 z-10 flex w-28 flex-col gap-1 rounded border p-1 text-[var(--mw-foreground)]"
      style={panel}
    >
      {props.children}
    </div>
  );
}

export function ToolHeading(props: { text: string }) {
  return <div className="text-[10px] opacity-60">{props.text}</div>;
}

export function ToolButton(props: {
  on: boolean;
  title: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className={`w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${
        props.on
          ? "bg-[var(--mw-list-active-background,#3794ff44)]"
          : "hover:bg-[var(--mw-list-hover-background,#8882)]"
      }`}
    >
      {props.label}
    </button>
  );
}

export function UndoRedo(props: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="mt-1 flex gap-1">
      <button
        type="button"
        title="Отменить (Ctrl+Z)"
        disabled={!props.canUndo}
        onClick={props.onUndo}
        className="flex-1 rounded text-[11px] disabled:opacity-30"
      >
        ↶
      </button>
      <button
        type="button"
        title="Повторить (Ctrl+Shift+Z)"
        disabled={!props.canRedo}
        onClick={props.onRedo}
        className="flex-1 rounded text-[11px] disabled:opacity-30"
      >
        ↷
      </button>
    </div>
  );
}

/** Отказ сервера или подсказка — строкой внизу холста, пока не сделают следующее. */
export function Message(props: { text: string; onClose: () => void }) {
  return (
    <div
      className="absolute bottom-2 left-1/2 z-10 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded border px-2 py-1 text-[11px]"
      style={{
        background: "var(--mw-editor-background)",
        borderColor: "var(--mw-error-foreground, #f14c4c)",
        color: "var(--mw-foreground)",
      }}
    >
      <span>{props.text}</span>
      <button type="button" className="opacity-60 hover:opacity-100" onClick={props.onClose}>
        ×
      </button>
    </div>
  );
}

/** Удаление объекта уносит папку и связи — поэтому спрашиваем, а не удаляем по клавише. */
export function Confirm(props: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <div
      className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded border px-2 py-1 text-[11px] text-[var(--mw-foreground)]"
      style={panel}
    >
      <span>{props.text}</span>
      <button type="button" className="rounded border px-1" onClick={props.onYes}>
        Удалить
      </button>
      <button type="button" className="rounded px-1 opacity-70" onClick={props.onNo}>
        Отмена
      </button>
    </div>
  );
}

/** Поповер справа вверху: превью объекта с «провалиться» или список склеенных связей. */
export function PopoverFrame(props: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="absolute top-2 right-2 z-10 flex max-h-[90%] w-[300px] flex-col gap-1 overflow-auto rounded border p-1 text-[var(--mw-foreground)]"
      style={panel}
    >
      <div className="flex justify-end">
        <button type="button" className="opacity-60 hover:opacity-100" onClick={props.onClose}>
          ×
        </button>
      </div>
      {props.children}
    </div>
  );
}

export function DiveButton(props: { onDive: () => void }) {
  return (
    <button type="button" className="rounded border px-2 py-0.5 text-[11px]" onClick={props.onDive}>
      Провалиться
    </button>
  );
}

export function RelationList(props: {
  items: { label: string; link: string }[];
  onPick: (link: string) => void;
}) {
  return (
    <div className="flex flex-col text-[11px]">
      <div className="opacity-60">Стрелка собрана из связей:</div>
      {props.items.map((item) => (
        <button
          type="button"
          key={item.link}
          className="truncate text-left hover:underline"
          onClick={() => props.onPick(item.link)}
          title={item.link}
        >
          {item.label} — {item.link.replace("mapward://", "")}
        </button>
      ))}
    </div>
  );
}
