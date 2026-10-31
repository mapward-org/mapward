import type { MetricProps } from "@mapward/component";
import { View, wrap } from "./frame.tsx";
import type { ViewParams } from "./source.ts";

/**
 * Вид `tree`: дерево `{ children: [{ label, link, isDir, children, status, git }] }` — так
 * отвечает `files.tree`, — или голый массив узлов.
 */
export default function Tree(props: MetricProps<ViewParams>) {
  return <View {...props} kind="tree" shape={wrap("children")} />;
}
