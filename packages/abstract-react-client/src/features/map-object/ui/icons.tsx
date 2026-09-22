const box = "size-4";

/**
 * Все иконки шапки и заголовков разделов нарисованы в одном боксе — `x 3…13`, `y 3…13`,
 * центр `8,8`. Иначе рядом стоящие кнопки выглядят съехавшими, хотя паддинги у них общие:
 * расходятся сами рисунки (решение 0028).
 */
export const DirectivesIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M3.5 3h6l3.5 3v7h-9.5z" strokeLinejoin="round" />
    <path d="M5.75 7.5h4.5M5.75 10h4.5" strokeLinecap="round" />
  </svg>
);

/** Этапы воркфлоу: шаги, идущие один за другим. */
export const WorkflowIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <circle cx="4" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="12" cy="8" r="1.4" />
    <path d="M5.4 8h1.2M9.4 8h1.2" strokeLinecap="round" />
  </svg>
);

export const ActionsIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M9 3 4.5 9.5H8L7 13l4.5-6.5H8z" strokeLinejoin="round" />
  </svg>
);

/** Метрики: столбики шкалы — то же, чем они показаны в сетке. */
export const MetricsIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M3.5 13V9M8 13V3.5M12.5 13V7" strokeLinecap="round" />
  </svg>
);

/** Новая директива: тот же лист, что у списка, с плюсом — действие, а не список. */
export const NewDirectiveIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M3.5 3h6l3.5 3v7h-9.5z" strokeLinejoin="round" />
    <path d="M8 6.75v4M6 8.75h4" strokeLinecap="round" />
  </svg>
);

/** Поиск по списку: лупа — линза и ручка в том же боксе, что остальные иконки заголовков. */
export const SearchIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <circle cx="7" cy="7" r="3.5" />
    <path d="m9.6 9.6 3.4 3.4" strokeLinecap="round" />
  </svg>
);

/** Об объекте: карточка с полями — всё, что объект о себе знает (решение 0024). */
export const MetaIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="3" y="3" width="10" height="10" rx="1" />
    <path d="M5.25 6h5.5M5.25 8.5h5.5M5.25 11h3.5" strokeLinecap="round" />
  </svg>
);

/** Открыть в табе: окно со стрелкой наружу — решение 0026. */
export const TabIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M8 3H3v10h10V8" strokeLinecap="round" />
    <path d="M10 3h3v3M13 3 8.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Запустить этап: треугольник плея. В строке директивы он вместо слова «этапы» — строка
 * узкая, и слово в ней отнимает место у имени (решение 0028). Меньше остальных: это кнопка
 * внутри списка, а не в шапке.
 */
export const RunIcon = (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
    <path d="M5.5 3.5 12 8l-6.5 4.5z" />
  </svg>
);

export const IndexIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="currentColor">
    <circle cx="4" cy="8" r="1.1" />
    <circle cx="8" cy="8" r="1.1" />
    <circle cx="12" cy="8" r="1.1" />
  </svg>
);
