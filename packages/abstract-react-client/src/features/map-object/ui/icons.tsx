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

export const IndexIcon = (
  <svg viewBox="0 0 16 16" className={box} fill="currentColor">
    <circle cx="4" cy="8" r="1.1" />
    <circle cx="8" cy="8" r="1.1" />
    <circle cx="12" cy="8" r="1.1" />
  </svg>
);
