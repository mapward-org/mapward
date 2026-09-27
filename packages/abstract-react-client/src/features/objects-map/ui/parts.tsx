import type { ReactNode } from "react";

/**
 * Части вьюхи карты вокруг холста — Miro-подобно, на токенах редактора (`--mw-*`), поэтому
 * одинаково в светлой и тёмной теме: рейка инструментов, контекстная панель у выделенного и её
 * выпадашки, поповер объекта, модалки и тост. Маленькие вью без состояния — собирает compose.
 */

const surface = {
  background: "var(--mw-editor-background)",
  borderColor: "var(--mw-panel-border, #8884)",
  color: "var(--mw-foreground)",
  boxShadow: "0 4px 12px rgba(0,0,0,.25)",
};

const hover = "hover:bg-[var(--mw-list-hover-background,#8882)]";
const active = "bg-[var(--mw-list-active-background,#3794ff44)]";
const ring = "outline outline-2 outline-offset-1 outline-[var(--mw-focus-border,#3794ff)]";

/** Рамка вьюхи: холст и всё, что лежит поверх него. */
export function MapFrame(props: { children: ReactNode }) {
  return <div className="relative h-full min-h-40 w-full">{props.children}</div>;
}

// ── Рейка инструментов ────────────────────────────────────────────────────────────────────

/** Вертикальная рейка слева, 44px: инструменты, прототипы, связи, отмена внизу. */
export function RailFrame(props: { children: ReactNode }) {
  return (
    <div
      className="absolute top-2 bottom-2 left-2 z-10 flex w-11 flex-col items-center gap-1 rounded-lg border py-1"
      style={surface}
    >
      {props.children}
    </div>
  );
}

export function RailSep() {
  return <div className="my-0.5 h-px w-7 bg-[var(--mw-panel-border,#8884)]" />;
}

export function RailSpacer() {
  return <div className="flex-1" />;
}

/** Кнопка рейки 32×32: иконка, подсказка, подсветка выбранного. */
export function RailButton(props: {
  icon: string;
  title: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-[14px] disabled:opacity-30 ${props.on ? active : hover}`}
    >
      {props.icon}
    </button>
  );
}

/** Чип прототипа: кружок его цвета, у связи — стрелка его цвета; имя — в подсказке. */
export function RailChip(props: {
  color?: string | undefined;
  label: string;
  title: string;
  arrow?: boolean;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md ${props.on ? active : hover}`}
    >
      {props.arrow ? (
        <span
          className="text-[15px] font-bold"
          style={{ color: props.color ?? "var(--mw-foreground)" }}
        >
          →
        </span>
      ) : (
        <span
          className="h-3.5 w-3.5 rounded-full border border-[var(--mw-panel-border,#8884)]"
          style={{ background: props.color ?? "var(--mw-editor-background)" }}
        />
      )}
    </button>
  );
}

/** Список прототипов сверх шести — выпадашка у кнопки «+», строками с цветом и именем. */
export function RailMoreList(props: { children: ReactNode }) {
  return (
    <div
      className="absolute left-12 z-20 flex max-h-72 w-48 flex-col overflow-auto rounded-lg border p-1 text-[12px]"
      style={surface}
    >
      {props.children}
    </div>
  );
}

export function RailMoreItem(props: {
  color?: string | undefined;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex h-7 items-center gap-2 rounded-md px-2 text-left ${props.on ? active : hover}`}
    >
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--mw-panel-border,#8884)]"
        style={{ background: props.color ?? "var(--mw-editor-background)" }}
      />
      <span className="truncate">{props.label}</span>
    </button>
  );
}

// ── Контекстная панель ────────────────────────────────────────────────────────────────────

/** Полоска над выделенным: 32px, радиус 8, тень; кнопки не тащат холст под собой. */
export function BarFrame(props: { children: ReactNode }) {
  return (
    <div
      className="nodrag nopan flex h-8 items-center gap-0.5 rounded-lg border px-1"
      style={surface}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.children}
    </div>
  );
}

export function BarSep() {
  return <div className="mx-0.5 h-5 w-px bg-[var(--mw-panel-border,#8884)]" />;
}

/** Место кнопки: выпадашка встаёт под своей кнопкой. */
export function BarSlot(props: { children: ReactNode; menu?: ReactNode }) {
  return (
    <div className="relative">
      {props.children}
      {props.menu}
    </div>
  );
}

/** Кнопка-иконка панели 28×28. */
export function BarIcon(props: {
  title: string;
  on?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-[13px] ${props.on ? active : hover}`}
      style={props.danger ? { color: "var(--mw-error-foreground, #f14c4c)" } : {}}
    >
      {props.children}
    </button>
  );
}

/** Заливка — кружок текущего цвета; без цвета — перечёркнутый. */
export function FillDot(props: { color?: string | undefined }) {
  return (
    <span
      className="h-4 w-4 rounded-full border border-[var(--mw-panel-border,#8884)]"
      style={{
        background:
          props.color ??
          "linear-gradient(135deg, transparent 45%, #f14c4c 45% 55%, transparent 55%)",
      }}
    />
  );
}

/** Обводка — кольцо текущего цвета. */
export function StrokeRing(props: { color?: string | undefined }) {
  return (
    <span
      className="h-4 w-4 rounded-full border-[3px]"
      style={{ borderColor: props.color ?? "var(--mw-foreground)" }}
    />
  );
}

/** Текст — «A», подчёркнутое цветом текста, и текущий размер числом. */
export function TextMark(props: { color?: string | undefined; size?: number | undefined }) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span
        className="font-semibold"
        style={{
          borderBottom: `3px solid ${props.color ?? "var(--mw-foreground)"}`,
          lineHeight: 1,
        }}
      >
        A
      </span>
      <span className="text-[9px] opacity-70">{props.size ?? ""}</span>
    </span>
  );
}

// ── Выпадашки ─────────────────────────────────────────────────────────────────────────────

/** Выпадашка под кнопкой панели. Клики внутри не доходят до холста. */
export function MenuFrame(props: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className={`nodrag nopan absolute top-9 left-0 z-30 flex flex-col gap-1.5 rounded-lg border p-2 text-[11px] ${props.wide ? "w-56" : "w-auto"}`}
      style={surface}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.children}
    </div>
  );
}

export function MenuLabel(props: { text: string }) {
  return <div className="opacity-60">{props.text}</div>;
}

const SWATCHES = [
  "#ffd166",
  "#ff9f43",
  "#ef476f",
  "#f4a6c1",
  "#cdb4db",
  "#8ecae6",
  "#219ebc",
  "#06d6a0",
  "#b8e0a8",
  "#ffffff",
  "#adb5bd",
  "#333333",
];

/** Образец 20px; выбранный — в кольце фокуса. */
function swatch(color: string | undefined, value: string | undefined) {
  return `h-5 w-5 rounded-md border border-[var(--mw-panel-border,#8884)] ${
    (value ?? "") === (color ?? "") ? ring : ""
  }`;
}

/** Сетка 6×2 образцов; выбранный — в кольце фокуса. */
export function ColorGrid(props: {
  value?: string | undefined;
  onPick: (color: string | undefined) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {SWATCHES.map((color) => (
        <button
          type="button"
          key={color}
          title={color}
          className={swatch(color, props.value)}
          style={{ background: color }}
          onClick={() => props.onPick(color)}
        />
      ))}
    </div>
  );
}

/** Недавние цвета — отдельным рядом; пусто — ряда нет. */
export function RecentColors(props: {
  value?: string | undefined;
  recent: string[];
  onPick: (color: string) => void;
}) {
  if (props.recent.length === 0) return null;
  return (
    <div className="flex gap-1" title="Недавние">
      {props.recent.map((color) => (
        <button
          type="button"
          key={color}
          title={`Недавний: ${color}`}
          className={swatch(color, props.value)}
          style={{ background: color }}
          onClick={() => props.onPick(color)}
        />
      ))}
    </div>
  );
}

/** «Без цвета» и «свой…» — палитрой редактора. */
export function ColorExtras(props: {
  value?: string | undefined;
  onPick: (color: string | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        title="Без цвета"
        className={`${swatch(undefined, props.value)} px-1`}
        onClick={() => props.onPick(undefined)}
      >
        ⌀
      </button>
      <label className="flex cursor-pointer items-center gap-1" title="Свой цвет">
        <input
          type="color"
          className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          value={/^#[0-9a-f]{6}$/i.test(props.value ?? "") ? props.value : "#888888"}
          onChange={(event) => props.onPick(event.currentTarget.value)}
        />
        свой…
      </label>
    </div>
  );
}

/** Ряд пресетов размера или толщины. */
export function Presets(props: {
  value?: number | undefined;
  presets: number[];
  onPick: (value: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {props.presets.map((size) => (
        <button
          type="button"
          key={size}
          onClick={() => props.onPick(size)}
          className={`h-6 min-w-6 rounded-md px-1 ${props.value === size ? active : hover}`}
        >
          {size}
        </button>
      ))}
    </div>
  );
}

/**
 * Число со степперами −/+. Поле без состояния: значение берётся на Enter и при уходе из поля, а
 * сменившееся снаружи подставляется ключом.
 */
export function Stepper(props: {
  value?: number | undefined;
  title: string;
  onPick: (value: number) => void;
  onStep: (delta: number) => void;
}) {
  const take = (raw: string) =>
    Number.isFinite(Number(raw)) && raw !== "" && props.onPick(Number(raw));
  const step = `h-6 w-6 rounded-md ${hover}`;
  return (
    <div className="flex items-center gap-1" title={props.title}>
      <button type="button" title="Меньше" className={step} onClick={() => props.onStep(-1)}>
        −
      </button>
      <input
        key={props.value ?? "none"}
        type="number"
        defaultValue={props.value}
        placeholder="…"
        className="h-6 w-14 rounded-md border border-[var(--mw-panel-border,#8884)] bg-transparent px-1 focus:outline focus:outline-[var(--mw-focus-border,#3794ff)]"
        onBlur={(event) => take(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") take(event.currentTarget.value);
        }}
      />
      <button type="button" title="Больше" className={step} onClick={() => props.onStep(1)}>
        +
      </button>
    </div>
  );
}

/** Сегментированный переключатель иконками: путь, стрелки. */
export function Segmented(props: {
  value?: string | undefined;
  options: readonly { key: string; icon: string; title: string }[];
  onPick: (key: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-[var(--mw-panel-border,#8884)] p-0.5">
      {props.options.map((option) => (
        <button
          type="button"
          key={option.key}
          title={option.title}
          onClick={() => props.onPick(option.key)}
          className={`h-6 min-w-7 rounded px-1.5 text-[13px] ${props.value === option.key ? `${active} ${ring}` : hover}`}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

// ── Поповер объекта ───────────────────────────────────────────────────────────────────────

/** Поповер 320px: карточка объекта или список склеенных связей. */
export function PopoverFrame(props: { children: ReactNode }) {
  return (
    <div
      className="nodrag nopan flex max-h-[60vh] w-80 flex-col gap-1 overflow-auto rounded-lg border p-1"
      style={surface}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.children}
    </div>
  );
}

/** Шапка списка склеенных связей: заголовок и ×. */
export function PopoverHead(props: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-1 px-1 text-[11px]">
      <span className="flex-1 font-semibold">{props.title}</span>
      <button
        type="button"
        title="Закрыть"
        className={`h-6 w-6 rounded-md ${hover}`}
        onClick={props.onClose}
      >
        ×
      </button>
    </div>
  );
}

export function RelationRow(props: { label: string; link: string; onPick: () => void }) {
  return (
    <button
      type="button"
      title={props.link}
      onClick={props.onPick}
      className={`flex h-7 items-center gap-2 rounded-md px-2 text-left text-[11px] ${hover}`}
    >
      <span className="truncate">{props.label}</span>
      <span className="ml-auto truncate font-mono text-[9px] opacity-50">
        {props.link.replace("mapward://", "")}
      </span>
    </button>
  );
}

/** Маленькая иконка в шапке карточки поповера: ✎ ↘ ×. */
export function HeadIcon(props: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={props.title}
      className={`nodrag flex h-5 w-5 items-center justify-center rounded text-[11px] ${hover}`}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      {props.icon}
    </button>
  );
}

// ── Модалки и тост ────────────────────────────────────────────────────────────────────────

/** Затемнённая подложка модалки: клик по ней — как «отмена». */
export function Backdrop(props: { onClose: () => void }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 z-20 bg-black/40" onClick={props.onClose} />
  );
}

const field =
  "h-7 rounded-md border border-[var(--mw-panel-border,#8884)] bg-transparent px-2 focus:outline focus:outline-2 focus:outline-[var(--mw-focus-border,#3794ff)]";
const secondary = `h-7 rounded-md px-3 ${hover}`;
const modal =
  "absolute top-1/2 left-1/2 z-30 flex w-[360px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border p-4 text-[12px]";

/** Диалог «имя и адрес»: Enter — сохранить, Esc — отмена. Поля без состояния. */
export function EditDialog(props: {
  name: string;
  folder: string;
  onSave: (name: string, folder: string) => void;
  onClose: () => void;
}) {
  return (
    <form
      className={modal}
      style={surface}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        props.onSave(String(data.get("name") ?? ""), String(data.get("folder") ?? ""));
      }}
      onKeyDown={(event) => event.key === "Escape" && props.onClose()}
    >
      <div className="text-[13px] font-semibold">Имя и адрес</div>
      <label className="flex flex-col gap-1">
        <span className="opacity-70">Имя</span>
        <input name="name" autoFocus defaultValue={props.name} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="opacity-70">Адрес — имя папки; смена переименует папку</span>
        <input name="folder" defaultValue={props.folder} className={`${field} font-mono`} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={secondary} onClick={props.onClose}>
          Отмена
        </button>
        <button
          type="submit"
          className="h-7 rounded-md bg-[var(--mw-button-background,#0e639c)] px-3 text-[var(--mw-button-foreground,#fff)]"
        >
          Сохранить
        </button>
      </div>
    </form>
  );
}

/** Подтверждение удаления: Enter — удалить, Esc — отмена; первичная — цветом ошибки. */
export function Confirm(props: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <form
      className={modal}
      style={surface}
      onSubmit={(event) => {
        event.preventDefault();
        props.onYes();
      }}
      onKeyDown={(event) => event.key === "Escape" && props.onNo()}
    >
      <div className="text-[13px] font-semibold">Удаление</div>
      <div>{props.text}</div>
      <div className="flex justify-end gap-2">
        <button type="button" className={secondary} onClick={props.onNo}>
          Отмена
        </button>
        <button
          type="submit"
          autoFocus
          className="h-7 rounded-md px-3 text-white"
          style={{ background: "var(--mw-error-foreground, #f14c4c)" }}
        >
          Удалить
        </button>
      </div>
    </form>
  );
}

/** Тост внизу по центру: подсказка гаснет сама, отказ сервера — до закрытия. */
export function Message(props: { text: string; error: boolean; onClose: () => void }) {
  return (
    <div
      className="absolute bottom-3 left-1/2 z-30 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px]"
      style={{
        ...surface,
        borderColor: props.error ? "var(--mw-error-foreground, #f14c4c)" : surface.borderColor,
      }}
    >
      <span
        style={{
          color: props.error
            ? "var(--mw-error-foreground, #f14c4c)"
            : "var(--mw-focus-border, #3794ff)",
        }}
      >
        {props.error ? "⚠" : "ℹ"}
      </span>
      <span>{props.text}</span>
      <button
        type="button"
        title="Закрыть"
        className="opacity-60 hover:opacity-100"
        onClick={props.onClose}
      >
        ×
      </button>
    </div>
  );
}
