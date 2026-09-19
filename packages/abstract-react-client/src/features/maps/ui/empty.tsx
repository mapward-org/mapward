export function Empty(props: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 p-3">
      <p className="text-[var(--mw-descriptionForeground)]">{props.text}</p>
      <button
        type="button"
        onClick={props.onAction}
        className="rounded-sm bg-[var(--mw-button-background)] px-3 py-1 text-[var(--mw-button-foreground)] hover:bg-[var(--mw-button-hoverBackground)]"
      >
        {props.action}
      </button>
    </div>
  );
}
