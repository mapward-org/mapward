import { useEffect } from "react";
import type { ActionInput } from "@mapward/core";
import type { FormValue, FormValues } from "../pure-model/actions.ts";

const field =
  "w-full rounded-sm border border-[var(--mw-input-border,#8884)] bg-[var(--mw-input-background,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--mw-input-foreground,inherit)] outline-none focus:border-[var(--mw-focusBorder,#48f)]";

const errorLine = "text-[11px] text-[var(--mw-errorForeground,#f85149)]";

function Field(props: {
  name: string;
  input: ActionInput;
  value: FormValue;
  error?: string;
  first: boolean;
  onChange: (value: FormValue) => void;
}) {
  const { input, value } = props;
  const text = typeof value === "string" ? value : "";
  const id = `mw-action-${props.name}`;
  // Фокус — в первое поле: форму открыли, чтобы в неё писать.
  const focus = props.first ? { autoFocus: true } : {};

  const control = (() => {
    switch (input.type ?? "string") {
      case "boolean":
        return (
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(event) => props.onChange(event.target.checked)}
            {...focus}
          />
        );
      case "choice":
        return (
          <select
            id={id}
            value={text}
            onChange={(event) => props.onChange(event.target.value)}
            className={field}
            {...focus}
          >
            {/* Пусто — «не выбрано»: обязательное без умолчания должен выбрать человек. */}
            {!input.options?.includes(text) && <option value={text}>{text || "—"}</option>}
            {input.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      case "number":
        return (
          <input
            id={id}
            type="number"
            value={text}
            onChange={(event) => props.onChange(event.target.value)}
            className={field}
            {...focus}
          />
        );
      default:
        return input.multiline ? (
          <textarea
            id={id}
            rows={4}
            value={text}
            onChange={(event) => props.onChange(event.target.value)}
            className={`${field} resize-y`}
            {...focus}
          />
        ) : (
          <input
            id={id}
            type="text"
            value={text}
            onChange={(event) => props.onChange(event.target.value)}
            className={field}
            {...focus}
          />
        );
    }
  })();

  const boolean = (input.type ?? "string") === "boolean";
  return (
    <div className="flex flex-col gap-0.5">
      <label
        htmlFor={id}
        className={`flex items-center gap-1.5 text-[11px] ${boolean ? "" : "opacity-80"}`}
      >
        {boolean && control}
        <span>
          {props.name}
          {input.required && <span className="opacity-60"> *</span>}
        </span>
      </label>
      {!boolean && control}
      {/* Подсказка — `description` поля: подписью служит имя, как в ручном запуске Actions. */}
      {input.description && <div className="text-[11px] opacity-60">{input.description}</div>}
      {props.error && <div className={errorLine}>{props.error}</div>}
    </div>
  );
}

/**
 * Форма экшона — решение 0038: поля из `inputs`, ошибки сервера у самих полей. Лежит поверх
 * вида, а не окном редактора: запуск — часть карты, и хосту без окон он тоже положен.
 *
 * Отправка ждёт только ответа «принято»: прогон идёт у сервера, и интерфейс не блокируется —
 * за ходом следят на экране прогонов.
 */
export function ActionForm(props: {
  title: string;
  description?: string;
  inputs: Record<string, ActionInput>;
  values: FormValues;
  errors: Record<string, string>;
  /** Что сказать над полями: ошибки по полям, которых в форме нет, и отказ сервера. */
  notes: string[];
  sending: boolean;
  onChange: (name: string, value: FormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { onCancel } = props;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onCancel]);

  const names = Object.keys(props.inputs);

  return (
    // Подложка ловит клик мимо формы — это «отмена», как Escape.
    <div
      className="absolute inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/30 p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
        className="flex w-full max-w-md flex-col gap-2 rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] p-3 shadow-lg"
      >
        <div className="font-medium">{props.title}</div>
        {props.description && <div className="text-[11px] opacity-70">{props.description}</div>}
        {props.notes.map((note) => (
          <div key={note} className={errorLine}>
            {note}
          </div>
        ))}
        {names.map((name, index) => (
          <Field
            key={name}
            name={name}
            input={props.inputs[name] ?? {}}
            value={props.values[name] ?? ""}
            first={index === 0}
            onChange={(value) => props.onChange(name, value)}
            {...(props.errors[name] === undefined ? {} : { error: props.errors[name] })}
          />
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm px-2 py-0.5 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={props.sending}
            // Без полей это подтверждение: `confirm` просил спросить, прежде чем запускать.
            {...(names.length === 0 ? { autoFocus: true } : {})}
            className="rounded-sm bg-[var(--mw-button-background,#0e639c)] px-2 py-0.5 text-[var(--mw-button-foreground,#fff)] hover:bg-[var(--mw-button-hoverBackground,#1177bb)] disabled:opacity-50"
          >
            Запустить
          </button>
        </div>
      </form>
    </div>
  );
}
