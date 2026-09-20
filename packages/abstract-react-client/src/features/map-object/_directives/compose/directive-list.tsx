import type { MapFile, MapStage } from "@mapward/core";
import { DirectiveRow } from "../ui/directive-row.tsx";

/**
 * Список директив — один и тот же в двух местах: незакрытые под названием объекта и все
 * в мета-экране (решение 0024). Чем они отличаются, решает вызывающий: что дать списком
 * и можно ли отсюда удалять.
 */
export function DirectiveList(props: {
  files: MapFile[];
  stages: MapStage[];
  onOpen?: (file: MapFile) => void;
  onRunStage?: (file: MapFile, stage: string) => void;
  onRemove?: (file: MapFile) => void;
}) {
  if (props.files.length === 0) return null;

  const open = props.onOpen;
  const runStage = props.onRunStage;
  const remove = props.onRemove;

  return (
    <div className="flex flex-col">
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
