import { tabHover } from "./tab-modifier.ts";

/** Куда ведёт стрелка: объект по ту сторону шага истории. Идти некуда — стрелки нет. */
export type Arrow = { name: string; address: string; go: () => void };

/**
 * `trail` — предки-объекты текущего объекта, от корня и без него самого: он написан заголовком
 * рядом. Групп в списке не бывает — их отсеивает `breadcrumbTrail`, иначе крошка вела бы в
 * папку, за которой объекта нет.
 *
 * Стрелки — назад и вперёд по истории вида, а не к родителю: к родителю ведёт последняя крошка
 * (решение 0036). Видны всегда, даже на корне: пропадая, они сдвигали бы крошки при каждом
 * переходе, поэтому когда идти некуда, стрелка гаснет.
 */
export function Breadcrumbs(props: {
  trail: { address: string; name: string }[];
  onGo: (address: string) => void;
  back?: Arrow | undefined;
  forward?: Arrow | undefined;
  /** Предок открывается и отдельным табом: ctrl + клик — решение 0026, без иконки — 0035. */
  onOpenTab?: (address: string) => void;
}) {
  const tab = props.onOpenTab;
  const arrow = (target: Arrow | undefined, sign: string, label: string) => (
    <button
      type="button"
      disabled={!target}
      title={target ? `${label}: ${target.name}` : label}
      onClick={(event) =>
        target && (tab && (event.ctrlKey || event.metaKey) ? tab(target.address) : target.go())
      }
      className="px-0.5 disabled:cursor-default disabled:opacity-30"
    >
      {sign}
    </button>
  );
  return (
    <nav className="flex flex-wrap items-center gap-1 px-2 py-1 text-[11px] opacity-70">
      <span className="flex items-center pr-1">
        {arrow(props.back, "←", "Назад")}
        {arrow(props.forward, "→", "Вперёд")}
      </span>
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
