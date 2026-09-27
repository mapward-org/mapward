import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";
import type { ActionRef } from "@mapward/core";
import type { RenderRowMenu } from "../ports.tsx";

/**
 * Строка с меню экшонов, если она их назвала и меню есть кому нарисовать; иначе строка как есть.
 * Меню рисуют экшоны — метрика только отдаёт им строку.
 */
export const WithRowMenu = observer(function WithRowMenu(props: {
  actions: ActionRef[] | undefined;
  render: RenderRowMenu | undefined;
  children: ReactNode;
}) {
  return props.actions?.length && props.render ? (
    <>{props.render(props.actions, props.children)}</>
  ) : (
    <>{props.children}</>
  );
});
