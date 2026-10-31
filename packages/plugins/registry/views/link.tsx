import type { MetricProps } from "@mapward/component";
import { View } from "./frame.tsx";
import type { ViewParams } from "./source.ts";

/** Вид `link`: одна ссылка `{ label, link, description, status }`, с пометкой git, если есть. */
export default function Link(props: MetricProps<ViewParams>) {
  return <View {...props} kind="link" />;
}
