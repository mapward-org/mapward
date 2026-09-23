import type { ReactNode } from "react";

/** Нечего показать — пояснение вместо дисплея: не собиралась, пусто, ещё грузится. */
export function DisplayNote(props: { note: string | undefined; children: ReactNode }) {
  return props.note ? <span className="opacity-60">{props.note}</span> : <>{props.children}</>;
}

export function PlainText(props: { text: string }) {
  return <span>{props.text}</span>;
}

export function StatusLine(props: { ok: boolean; summary?: string | undefined; dot: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {props.dot}
      <span>{props.summary ?? (props.ok ? "ок" : "не ок")}</span>
    </span>
  );
}

export function WrongShape(props: { reason: string }) {
  return (
    <span className="text-[var(--mw-errorForeground)]" title={props.reason}>
      данные не той формы: {props.reason}
    </span>
  );
}

export function EmptyList(props: { text?: string | undefined }) {
  return <span className="opacity-60">{props.text ?? "нет таких"}</span>;
}
