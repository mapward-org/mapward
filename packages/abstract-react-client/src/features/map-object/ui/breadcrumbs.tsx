export function Breadcrumbs(props: {
  trail: { address: string; name: string }[];
  onGo: (address: string) => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 px-2 py-1 text-[11px] opacity-70">
      {props.trail.length > 1 && (
        <button
          type="button"
          title="Назад"
          onClick={() => props.onGo(props.trail.at(-2)?.address ?? "")}
          className="pr-1"
        >
          ←
        </button>
      )}
      {props.trail.map((step, index) => (
        <span key={step.address} className="flex items-center gap-1">
          {index > 0 && <span className="opacity-50">/</span>}
          <button
            type="button"
            onClick={() => props.onGo(step.address)}
            className="hover:underline"
          >
            {step.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
