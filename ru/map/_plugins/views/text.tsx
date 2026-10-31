import type { MetricProps } from "@mapward/component";
import { View, text } from "./frame.tsx";
import type { ViewParams } from "./source.ts";

/** Вид `text`: `{ text }` или голая строка; не json-ответ `shell.json` — тоже `{ text }`. */
export default function Text(props: MetricProps<ViewParams>) {
  return <View {...props} kind="text" shape={text} />;
}
