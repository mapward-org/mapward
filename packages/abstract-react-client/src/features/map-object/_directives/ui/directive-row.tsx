import type { MapFile, MapStage } from "@mapward/core";
import { ListRow } from "../../../../lib/ui/list-row.tsx";
import { directiveHint, fileStatus, statusColor } from "../../pure-model/directives.ts";

/**
 * Директива строкой: имя, где она сейчас, этапы кнопками на наведении.
 *
 * Кнопка этапа не запускает его, а просит агента запустить: в живую сессию уходит фраза,
 * промпт агент берёт из MCP сам — решение 0017. Этапы те же, что действуют на объекте,
 * поэтому новый файл этапа даёт новую кнопку без правки кода.
 */
export function DirectiveRow(props: {
  file: MapFile;
  stages: MapStage[];
  onOpen?: () => void;
  onRunStage?: (stage: string) => void;
  onRemove?: () => void;
}) {
  const runStage = props.onRunStage;

  return (
    <ListRow
      label={props.file.name}
      hint={directiveHint(props.file)}
      hintClass={statusColor[fileStatus(props.file)]}
      {...(props.onOpen === undefined ? {} : { onSelect: props.onOpen })}
      {...(props.onRemove === undefined ? {} : { onRemove: props.onRemove })}
      {...(runStage === undefined
        ? {}
        : {
            actions: props.stages.map((stage) => ({
              // Многоточие значит «идёт сейчас», поэтому смотрим не на последний прогон,
              // а на незакрытый: закончившийся этап помечать нечем.
              label:
                props.file.run?.stage === stage.name && props.file.run.finishedAt === undefined
                  ? `${stage.name}…`
                  : stage.name,
              onSelect: () => runStage(stage.name),
            })),
          })}
    />
  );
}
