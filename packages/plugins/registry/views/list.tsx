import type { MetricProps } from "@mapward/component";
import { View, wrap } from "./frame.tsx";
import type { ViewParams } from "./source.ts";

/**
 * Вид `list`: пункты `{ items: [{ label, link, description, status, action, actions }] }` или
 * голый массив пунктов.
 */
export default function List(props: MetricProps<ViewParams>) {
  return <View {...props} kind="list" shape={wrap("items")} />;
}
