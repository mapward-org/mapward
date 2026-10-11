import type { ReactNode } from "react";
import type { CardSize } from "@mapward/core";
import { canvasClasses } from "../../../lib/ui/canvas-classes.ts";
import { GripIcon } from "../../../lib/ui/icons.tsx";
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

/**
 * Шапка — одна строка: имя и кнопки, без линии снизу. Тащится карточка только за ручку слева:
 * имя — ссылка, и тащить за неё значило бы путать «двигаю» с «проваливаюсь». Ручку рисует только
 * место, где карточку двигают, — холст; в списке и в метрике она была бы мёртвой.
 */
export function CardHead(props: { children: ReactNode; buttons?: ReactNode; draggable?: boolean }) {
  return (
    <header className="relative z-10 flex shrink-0 items-center gap-1 px-1.5 py-0.5">
      {props.draggable && (
        <span
          title="Перетащить"
          className={`${canvasClasses.dragHandle} -ml-1 shrink-0 cursor-grab opacity-50 hover:opacity-100`}
        >
          {GripIcon}
        </span>
      )}
      {props.children}
      <span className="ml-auto flex shrink-0 gap-0.5">{props.buttons}</span>
    </header>
  );
}

export function CardName(props: {
  name: string;
  prototypeName?: string | undefined;
  /** Адрес — в подсказке на имени вместе с прототипом: прототипы различают по цвету. */
  address: string;
  onOpen: () => void;
  /** Ctrl + клик — отдельным табом; без табов — просто переход. */
  onOpenTab?: (() => void) | undefined;
}) {
  // Имя — главное, и ему отдана вся строка до кнопок, до двух строк переноса. Прототип и адрес
  // ушли в подсказку: строка под именем съедала высоту, а прототип и так виден по цвету.
  const where = props.address.replace("mapward://", "") || "корень";
  return (
    <button
      type="button"
      onClick={(event) =>
        props.onOpenTab && (event.ctrlKey || event.metaKey) ? props.onOpenTab() : props.onOpen()
      }
      title={`${props.prototypeName ? `${props.prototypeName} · ` : ""}${where}${
        props.onOpenTab ? "\nCtrl + клик — отдельным табом" : ""
      }`}
      className={`line-clamp-2 min-w-0 flex-1 text-left font-medium break-words ${props.onOpenTab ? tabHover.tabLink : "hover:underline"}`}
    >
      {props.name}
    </button>
  );
}

/** Сообщение вместо метрик: нет объекта или нет названной вкладки. */
export function CardNote(props: { text: string }) {
  return <p className="px-2 py-1 text-[var(--mw-descriptionForeground)]">{props.text}</p>;
}
