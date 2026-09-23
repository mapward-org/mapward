/** One glyph rotated, not two different ones: the row keeps its geometry when it folds. */
export function FoldChevron(props: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`size-4 shrink-0 transition-transform duration-100 ${props.open ? "rotate-90" : ""}`}
    >
      <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
