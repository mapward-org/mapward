import type { GitMark as Mark } from "../pure-model/display.ts";
import { gitColor, gitHint } from "../pure-model/display.ts";

/**
 * Пометка git у узла — буква справа, цветом статуса, как в проводнике редактора (решение 0023).
 *
 * У папки буквы нет: свёрнутая папка несёт пометку сильнейшего потомка, и буква на ней читалась
 * бы как «изменилась сама папка». Цвет имени папка при этом получает — он и говорит, что внутри
 * что-то есть.
 */
export function GitMark(props: { mark: Mark; folder?: boolean }) {
  const color = gitColor(props.mark);
  if (!color || props.folder) return null;
  return (
    <span
      className="shrink-0 text-[11px] font-semibold"
      style={{ color }}
      title={gitHint(props.mark)}
    >
      {props.mark.git}
    </span>
  );
}
