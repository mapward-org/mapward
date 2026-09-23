import type { MapFile, MapStage } from "@mapward/core";
import { ListRow } from "../../../lib/ui/list-row.tsx";
import { RunIcon } from "../../../lib/ui/icons.tsx";
import { directiveHint, directiveHintClass, directiveLabel } from "../../../kernel/directives.ts";

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
  onOpen?: ((file: MapFile) => void) | undefined;
  onRunStage?: ((file: MapFile, stage: string) => void) | undefined;
  onRemove?: ((file: MapFile) => void) | undefined;
}) {
  const { file, onOpen, onRunStage: runStage, onRemove } = props;

  return (
    <ListRow
      label={directiveLabel(file)}
      // Полное имя тултипом: две директивы одного дня в списке иначе неразличимы.
      title={file.name}
      hint={directiveHint(file)}
      hintClass={directiveHintClass(file)}
      {...(onOpen === undefined ? {} : { onSelect: () => onOpen(file) })}
      // Крестик — только у своей директивы: унаследованная лежит в папке прототипа,
      // и убирают её там.
      {...(onRemove === undefined || file.owner !== undefined
        ? {}
        : { onRemove: () => onRemove(file) })}
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
                  file.run?.stage === stage.name && file.run.finishedAt === undefined
                    ? `${stage.name}…`
                    : stage.name,
                onSelect: () => runStage(file, stage.name),
              })),
            },
          })}
    />
  );
}
