import type { MetricProps } from "@mapward/component";
import { View } from "./frame.tsx";
import type { ViewParams } from "./source.ts";

/** Вид `status`: прошло или нет — `{ ok, summary }`. */
export default function Status(props: MetricProps<ViewParams>) {
  return <View {...props} kind="status" />;
}
