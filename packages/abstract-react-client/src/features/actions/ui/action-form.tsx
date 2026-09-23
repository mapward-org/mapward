import type { ReactNode } from "react";
import type { FormField as Field, FormValue } from "../pure-model/actions.ts";

const control =
  "w-full rounded-sm border border-[var(--mw-input-border,#8884)] bg-[var(--mw-input-background,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--mw-input-foreground,inherit)] outline-none focus:border-[var(--mw-focusBorder,#48f)]";

const errorLine = "text-[11px] text-[var(--mw-errorForeground,#f85149)]";

/** Фокус — в первое поле: форму открыли, чтобы в неё писать. */
const focus = (field: Field) => (field.first ? { autoFocus: true } : {});

type Control = { field: Field; onChange: (value: FormValue) => void };

/**
 * Форма экшона — решение 0038: поля из `inputs`, ошибки сервера у самих полей. Лежит поверх
 * вида, а не окном редактора: запуск — часть карты, и хосту без окон он тоже положен.
 *
 * Отправка ждёт только ответа «принято»: прогон идёт у сервера, и интерфейс не блокируется —
 * за ходом следят на экране прогонов. Escape закрывает форму — это слушает стор запуска.
 */
export function ActionFormFrame(props: {
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const { onCancel } = props;
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
        {props.children}
      </form>
    </div>
  );
}

export function FormHead(props: { title: string; description?: string | undefined }) {
  return (
    <>
      <div className="font-medium">{props.title}</div>
      {props.description && <div className="text-[11px] opacity-70">{props.description}</div>}
    </>
  );
}

/** Что сказать над полями: ошибки по полям, которых в форме нет, и отказ сервера. */
export function FormNote(props: { text: string }) {
  return <div className={errorLine}>{props.text}</div>;
}

export function FormButtons(props: {
  sending: boolean;
  /** Полей нет — это подтверждение: `confirm` просил спросить, прежде чем запускать. */
  confirm: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={props.onCancel}
        className="rounded-sm px-2 py-0.5 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
      >
        Отмена
      </button>
      <button
        type="submit"
        disabled={props.sending}
        {...(props.confirm ? { autoFocus: true } : {})}
        className="rounded-sm bg-[var(--mw-button-background,#0e639c)] px-2 py-0.5 text-[var(--mw-button-foreground,#fff)] hover:bg-[var(--mw-button-hoverBackground,#1177bb)] disabled:opacity-50"
      >
        Запустить
      </button>
    </div>
  );
}

/**
 * Поле формы: подписью служит имя, как в ручном запуске Actions, подсказка — `description`
 * поля. Флажок стоит в подписи, остальное — под ней.
 */
export function FormField(props: { field: Field; control: ReactNode }) {
  const { field } = props;
  const boolean = field.kind === "boolean";
  return (
    <div className="flex flex-col gap-0.5">
      <label
        htmlFor={field.id}
        className={`flex items-center gap-1.5 text-[11px] ${boolean ? "" : "opacity-80"}`}
      >
        {boolean && props.control}
        <span>
          {field.name}
          {field.required && <span className="opacity-60"> *</span>}
        </span>
      </label>
      {!boolean && props.control}
      {field.description && <div className="text-[11px] opacity-60">{field.description}</div>}
      {field.error && <div className={errorLine}>{field.error}</div>}
    </div>
  );
}

export function CheckboxControl(props: Control) {
  return (
    <input
      id={props.field.id}
      type="checkbox"
      checked={props.field.checked}
      onChange={(event) => props.onChange(event.target.checked)}
      {...focus(props.field)}
    />
  );
}

export function ChoiceControl(props: Control) {
  const { field } = props;
  return (
    <select
      id={field.id}
      value={field.text}
      onChange={(event) => props.onChange(event.target.value)}
      className={control}
      {...focus(field)}
    >
      {/* Пусто — «не выбрано»: обязательное без умолчания должен выбрать человек. */}
      {!field.options.includes(field.text) && (
        <option value={field.text}>{field.text || "—"}</option>
      )}
      {field.options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/** Текст, число или многострочный текст — одно поле ввода разного вида. */
export function TextControl(props: Control) {
  const { field } = props;
  return field.kind === "multiline" ? (
    <textarea
      id={field.id}
      rows={4}
      value={field.text}
      onChange={(event) => props.onChange(event.target.value)}
      className={`${control} resize-y`}
      {...focus(field)}
    />
  ) : (
    <input
      id={field.id}
      type={field.kind === "number" ? "number" : "text"}
      value={field.text}
      onChange={(event) => props.onChange(event.target.value)}
      className={control}
      {...focus(field)}
    />
  );
}
