import type { ReactNode } from "react";
import type { CardSize } from "@mapward/core";
import { canvasClasses } from "../../../lib/ui/canvas-classes.ts";
import { tabHover } from "../../../lib/ui/tab-hover.ts";
import { cssSize } from "../pure-model/card.ts";

/**
 * Рамка карточки. Размер — свойство места, где карточка нарисована: ширины нет — вся ширина
 * места, высоты нет — растёт по содержимому. С `maxHeight` шапка стоит, а тело прокручивается
 * целиком — как область метрик на экране объекта.
 */
export function CardFrame(props: {
  width?: CardSize | undefined;
  maxHeight?: CardSize | undefined;
  header?: ReactNode;
  children?: ReactNode;
}) {
  const width = cssSize(props.width);
  const maxHeight = cssSize(props.maxHeight);
  return (
    <div
      // Метка для места показа: холст растягивает карточку на весь узел, находя её по ней.
      data-card-frame=""
      style={{ ...(width ? { width } : {}), ...(maxHeight ? { maxHeight } : {}) }}
      className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-[var(--mw-panel-border,#8884)] bg-[var(--mw-editor-background)] text-[var(--mw-foreground)]"
    >
      {props.header}
      {props.children}
    </div>
  );
}

/** Тело карточки: прокручивается целиком, колесо над ним не масштабирует холст карты. */
export function CardBody(props: { children: ReactNode }) {
  return (
    <div
      className={`min-h-0 flex-1 overflow-auto ${canvasClasses.noWheel}`}
      style={{ containerType: "inline-size" }}
    >
      {props.children}
    </div>
  );
}

/** Шапка: за неё карточка тащится по холсту; имя с прототипом — ссылка на объект. */
export function CardHead(props: { children: ReactNode; buttons?: ReactNode }) {
  return (
    <header
      className={`${canvasClasses.dragHandle} relative z-10 flex shrink-0 items-center gap-1 border-b border-[var(--mw-panel-border,#8884)] px-1.5 py-0.5`}
    >
      {props.children}
      <span className="ml-auto flex shrink-0 gap-0.5">{props.buttons}</span>
    </header>
  );
}

export function CardName(props: {
  name: string;
  prototypeName?: string | undefined;
  /** Адрес под именем, мелко: видно, где объект лежит и что правится как «адрес». */
  address: string;
  onOpen: () => void;
  /** Ctrl + клик — отдельным табом; без табов — просто переход. */
  onOpenTab?: (() => void) | undefined;
}) {
  // Имя — главное, и ему отдана вся строка до кнопок, до двух строк переноса. Прототип бывает
  // длинным и раньше съедал имя целиком — он ушёл вниз, к адресу, мелко.
  const where = props.address.replace("mapward://", "") || "корень";
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <button
        type="button"
        onClick={(event) =>
          props.onOpenTab && (event.ctrlKey || event.metaKey) ? props.onOpenTab() : props.onOpen()
        }
        title={`${props.prototypeName ? `${props.prototypeName}: ` : ""}${props.name}${
          props.onOpenTab ? " — Ctrl + клик: отдельным табом" : ""
        }`}
        className={`line-clamp-2 min-w-0 text-left font-medium break-words ${props.onOpenTab ? tabHover.tabLink : "hover:underline"}`}
      >
        {props.name}
      </button>
      <span
        className="truncate text-[9px] leading-tight opacity-60"
        title={`${props.prototypeName ? `${props.prototypeName} · ` : ""}${props.address}`}
      >
        {props.prototypeName && <span>{props.prototypeName} · </span>}
        <span className="font-mono">{where}</span>
      </span>
    </span>
  );
}

/** Сообщение вместо метрик: нет объекта или нет названной вкладки. */
export function CardNote(props: { text: string }) {
  return <p className="px-2 py-1 text-[var(--mw-descriptionForeground)]">{props.text}</p>;
}
