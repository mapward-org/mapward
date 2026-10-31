import type { MetricProps } from "@mapward/component";
import { View, text } from "./frame.tsx";
import type { ViewParams } from "./source.ts";

/** Вид `markdown`: `{ text }` или голая строка — разметкой: заголовки, списки, ссылки, код. */
export default function Markdown(props: MetricProps<ViewParams>) {
  return <View {...props} kind="markdown" shape={text} />;
}
