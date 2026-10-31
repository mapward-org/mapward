import type { GitLetter, Status } from "./types.ts";
import { gitColor, gitHint, statusColor, statusHint } from "./marks.ts";

/**
 * Точка статуса рядом с подписью: четыре известных статуса со своим цветом, любой другой — свой
 * `color` или нейтральный. Имя — в подсказке, так незнакомый цвет всё равно читается.
 */
export function StatusDot(props: { status?: Status; color?: string; hint?: string }) {
  const color = statusColor(props);
  if (!color) return null;
  return (
    <span className="shrink-0" style={{ color }} title={statusHint(props)}>
      ●
    </span>
  );
}

/**
 * Буква git справа, цветом статуса, как в проводнике редактора. У папки буквы нет: свёрнутая
 * папка несёт пометку сильнейшего потомка, и буква читалась бы как «изменилась сама папка».
 */
export function GitMark(props: { git?: GitLetter | undefined; folder?: boolean }) {
  const mark = props.git === undefined ? {} : { git: props.git };
  const color = gitColor(mark);
  if (!color || props.folder) return null;
  return (
    <span className="shrink-0 text-[11px] font-semibold" style={{ color }} title={gitHint(mark)}>
      {props.git}
    </span>
  );
}
