import type { StatusMark } from "../pure-model/display.ts";
import { statusColor, statusHint } from "../pure-model/display.ts";

/**
 * A status is a dot next to the label: four known states carry their own colour, anything else
 * brings its own — decision 0010. The name shows in the tooltip, so an unfamiliar colour is
 * still readable.
 */
export function StatusDot(props: { mark: StatusMark }) {
  const color = statusColor(props.mark);
  if (!color) return null;
  return (
    <span className="shrink-0" style={{ color }} title={statusHint(props.mark)}>
      ●
    </span>
  );
}
