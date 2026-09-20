const box = "size-4";

export const DirectivesIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M4 2.5h6l2.5 2.5v8.5H4z" />
    <path d="M6 7h4M6 9.5h4" strokeLinecap="round" />
  </svg>
);

/** Этапы воркфлоу: шаги, идущие один за другим. */
export const WorkflowIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <circle cx="3.5" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="12.5" cy="8" r="1.4" />
    <path d="M4.9 8h1.7M9.4 8h1.7" strokeLinecap="round" />
  </svg>
);

export const ActionsIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M8.5 2 4 9h3.5L7 14l4.5-7H8z" strokeLinejoin="round" />
  </svg>
);

/** Метрики: столбики шкалы — то же, чем они показаны в сетке. */
export const MetricsIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M3 13V9M8 13V4M13 13v-6" strokeLinecap="round" />
  </svg>
);

/** Новая директива: тот же лист, что у списка, с плюсом — действие, а не список. */
export const NewDirectiveIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M4 2.5h6l2.5 2.5v8.5H4z" />
    <path d="M8 6.5v5M5.5 9h5" strokeLinecap="round" />
  </svg>
);

/** Об объекте: карточка с полями — всё, что объект о себе знает (решение 0024). */
export const MetaIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="2.5" y="3" width="11" height="10" rx="1" />
    <path d="M5 6h6M5 8.5h6M5 11h3.5" strokeLinecap="round" />
  </svg>
);

/** Открыть в табе: окно со стрелкой наружу — решение 0026. */
export const TabIcon = (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M8.5 3H3.5v9.5H13V7.5" strokeLinecap="round" />
    <path d="M10 3h3v3M13 3l-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IndexIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="currentColor">
    <circle cx="4" cy="8" r="1.1" />
    <circle cx="8" cy="8" r="1.1" />
    <circle cx="12" cy="8" r="1.1" />
  </svg>
);
