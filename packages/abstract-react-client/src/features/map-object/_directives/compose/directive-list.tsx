import type { MapFile, MapStage } from "@mapward/core";
import { DirectiveRow } from "../ui/directive-row.tsx";

/**
 * Список директив — один и тот же в двух местах: незакрытые под названием объекта и все
 * в мета-экране (решение 0024). Чем они отличаются, решает вызывающий: что дать списком
 * и можно ли отсюда удалять.
 *
 * На первом экране список прокручивается после пяти строк — решение 0028. Это не потолок:
 * в списке остаются все, и видно, что их больше, — просто экран под ними не съедается.
 * В мета-экране высота не режется: там прокручивается он сам.
 */
export function DirectiveList(props: {
  files: MapFile[];
  stages: MapStage[];
  /** Список на первом экране: пять строк и прокрутка. */
  compact?: boolean;
  /** Что написать вместо пустого места. Без него пустой список не рисуется вовсе. */
  empty?: string;
  onOpen?: (file: MapFile) => void;
  onRunStage?: (file: MapFile, stage: string) => void;
  onRemove?: (file: MapFile) => void;
}) {
  if (props.files.length === 0) {
    return props.empty === undefined ? null : (
      <p className="px-3 py-0.5 text-[11px] opacity-50">{props.empty}</p>
    );
  }

  const open = props.onOpen;
  const runStage = props.onRunStage;
  const remove = props.onRemove;

  return (
    <div className={`flex flex-col ${props.compact ? "max-h-[7.5rem] overflow-y-auto" : ""}`}>
      {props.files.map((file) => (
        <DirectiveRow
          key={file.path}
          file={file}
          stages={props.stages}
          {...(open === undefined ? {} : { onOpen: () => open(file) })}
          {...(runStage === undefined
            ? {}
            : { onRunStage: (stage: string) => runStage(file, stage) })}
          {...(remove === undefined || file.owner !== undefined
            ? {}
            : // Крестик — только у своей директивы: унаследованная лежит в папке прототипа,
              // и убирают её там.
              { onRemove: () => remove(file) })}
        />
      ))}
    </div>
  );
}
