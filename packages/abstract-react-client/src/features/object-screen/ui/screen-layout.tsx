import type { ReactNode } from "react";

/**
 * Разметка экрана объекта — то, что раньше лежало тегами прямо в сборке. Сборка теперь только
 * расставляет части по местам (решение 0042), а как они лежат, решает этот файл.
 */

/** Весь экран. `relative` — для формы экшона: она ложится поверх вида, а не окном (0038). */
export function ScreenFrame(props: { children: ReactNode }) {
  return <div className="relative flex h-full flex-col pb-2">{props.children}</div>;
}

/**
 * Таб метрики — свой экран, а не объект с одной клеткой: шапки, директив и вкладок в нём нет,
 * метрика занимает всё. Возврат к объекту — одной строкой сверху, иначе из такого таба некуда
 * идти (решение 0026).
 */
export function SoloBar(props: { object: string; metric: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onBack}
      title="Показать объект целиком"
      className="flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] opacity-60 hover:opacity-100"
    >
      <span className="truncate">{props.object}</span>
      <span>/</span>
      <span className="truncate">{props.metric}</span>
    </button>
  );
}

/** Метрика таба занимает всё, что осталось под строкой возврата. */
export function SoloBody(props: { children: ReactNode }) {
  return <div className="min-h-0 flex-1">{props.children}</div>;
}

/**
 * Ключ, занятый и метрикой, и экшоном, — ошибка объекта (решение 0038): раскладка находит
 * клетку по ключу, и вид не угадывает, что из двух туда ставить.
 */
export function ClashNote(props: { keys: string[] }) {
  if (props.keys.length === 0) return null;
  return (
    <div className="shrink-0 px-2 pb-1 text-[11px] text-[var(--mw-errorForeground,#f85149)]">
      {props.keys.length === 1 ? "ключ" : "ключи"} {props.keys.join(", ")} — и у метрики, и у
      экшона: в клетке остаётся метрика, кнопкой экшон в сетку не встаёт. Переименуйте один из них.
    </div>
  );
}

/**
 * Незакрытые директивы — на первом экране, под названием и до метрик: с ними работают
 * постоянно, а выполненные лежат в мета-экране (решение 0024). Граница отделяет их от метрик.
 */
export function DirectivesBar(props: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-[var(--mw-menu-border,#8884)] pb-1">
      {props.children}
    </div>
  );
}

/** Описание открытой вкладки — над сеткой, разметкой (решение 0025). */
export function GroupDescription(props: { children: ReactNode }) {
  return <div className="shrink-0 px-2 pb-1 text-[11px] opacity-70">{props.children}</div>;
}

/**
 * Метрики растут по содержимому, и прокручивается эта область, а шапка, директивы и вкладки
 * стоят на месте (решение 0033). Она же — контейнер для `@container`-условий раскладки: без
 * `container-type` ни одно из них не срабатывает.
 */
export function ScreenBody(props: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto" style={{ containerType: "inline-size" }}>
      {props.children}
    </div>
  );
}

/** Пока карта не дочитана, на месте экрана — строка о том, что идёт. */
export function Reading() {
  return <p className="p-3 text-[var(--mw-descriptionForeground)]">Читаем карту…</p>;
}
