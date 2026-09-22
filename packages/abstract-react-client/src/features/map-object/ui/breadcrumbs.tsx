import { tabHover } from "./tab-modifier.ts";

/**
 * `trail` — предки-объекты текущего объекта, от корня и без него самого: он написан заголовком
 * рядом. Поэтому родитель — последний в списке, и кнопка назад есть у всякого, у кого предок
 * есть, включая ребёнка корня. Групп в списке не бывает — их отсеивает `breadcrumbTrail`,
 * иначе назад вело бы в папку, за которой объекта нет.
 */
export function Breadcrumbs(props: {
  trail: { address: string; name: string }[];
  onGo: (address: string) => void;
  /** Предок открывается и отдельным табом: ctrl + клик — решение 0026, без иконки — 0035. */
  onOpenTab?: (address: string) => void;
}) {
  const tab = props.onOpenTab;
  return (
    <nav className="flex flex-wrap items-center gap-1 px-2 py-1 text-[11px] opacity-70">
      {props.trail.length > 0 && (
        <button
          type="button"
          title="Назад"
          onClick={() => props.onGo(props.trail.at(-1)?.address ?? "")}
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
            onClick={(event) =>
              tab && (event.ctrlKey || event.metaKey) ? tab(step.address) : props.onGo(step.address)
            }
            {...(tab === undefined ? {} : { title: "Ctrl + клик — открыть отдельным табом" })}
            className={tab ? tabHover.tabLink : "hover:underline"}
          >
            {step.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
