export function Empty(props: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 p-3 text-sm">
      <p className="opacity-70">{props.text}</p>
      <button
        type="button"
        onClick={props.onAction}
        className="rounded border border-current/30 px-2 py-1 hover:bg-current/10"
      >
        {props.action}
      </button>
    </div>
  );
}
