import type { MapFile, MapStage } from "@mapward/core";
import { ListRow } from "../../../../lib/ui/list-row.tsx";
import { RunIcon } from "../../ui/icons.tsx";
import { directiveHint, directiveHintClass, directiveLabel } from "../../pure-model/directives.ts";

/**
 * Директива строкой: имя без шума, где она сейчас, этапы в меню на кнопке с плеем.
 *
 * Кнопка этапа не запускает его, а просит агента запустить: в живую сессию уходит фраза,
 * промпт агент берёт из MCP сам — решение 0017. Этапы те же, что действуют на объекте,
 * поэтому новый файл этапа даёт новый пункт без правки кода.
 *
 * Меню открывается кликом, а не наведением (решение 0028); клик по самой строке открывает
 * файл директивы — за этим её и читают.
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
      label={directiveLabel(props.file)}
      // Полное имя тултипом: две директивы одного дня в списке иначе неразличимы.
      title={props.file.name}
      hint={directiveHint(props.file)}
      hintClass={directiveHintClass(props.file)}
      {...(props.onOpen === undefined ? {} : { onSelect: props.onOpen })}
      {...(props.onRemove === undefined ? {} : { onRemove: props.onRemove })}
      {...(runStage === undefined
        ? {}
        : {
            menu: {
              label: RunIcon,
              title: "Запустить этап",
              actions: props.stages.map((stage) => ({
                // Многоточие значит «идёт сейчас», поэтому смотрим не на последний прогон,
                // а на незакрытый: закончившийся этап помечать нечем.
                label:
                  props.file.run?.stage === stage.name && props.file.run.finishedAt === undefined
                    ? `${stage.name}…`
                    : stage.name,
                onSelect: () => runStage(stage.name),
              })),
            },
          })}
    />
  );
}
