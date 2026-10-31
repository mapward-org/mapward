import type { ComponentBuild } from "@mapward/core";
import type { ActionFormProps } from "@mapward/component";
import type { Feed } from "../../../lib/store/feed.ts";
import { useWatch } from "../../../lib/store/use-watch.ts";
import { useMetricsPort } from "../ports.tsx";
import { ComponentDisplay } from "./component-display.tsx";

/**
 * Своя форма экшона — `component` в его `config.json`. Это тот же компонент для сборщика и
 * рантайма, что компонент метрики: сервер собирает, здесь выполняется с набором
 * `@mapward/component`. Форму открывает фича экшонов, рисовать компоненты умеют метрики — стыкует
 * их точка входа (решение 0042).
 */
export function ActionFormComponent(props: { action: string; props: ActionFormProps }) {
  const port = useMetricsPort();
  return <ActionFormBuild build={port.builds.actionForm(props.action)} props={props.props} />;
}

function ActionFormBuild(props: { build: Feed<ComponentBuild>; props: ActionFormProps }) {
  useWatch(props.build);
  return <ComponentDisplay build={props.build.value} display={props.props} links={{}} />;
}
