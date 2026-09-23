import { observer } from "mobx-react-lite";
import type { DisplayBuild, MapMetric, MapObject } from "@mapward/core";
import type { MetricValue } from "../model/grid-store.ts";
import type { TreeOpen } from "../pure-model/tree-open.ts";
import { useMetricsPort } from "../ports.tsx";
import { ComponentDisplay } from "./component-display.tsx";

/**
 * Ячейка со своим компонентом — решение 0037: сборка и пропсы, которые компонент получает.
 * Экшоны объекта и запуск — решение 0038: `run` идёт тем же путём, что кнопка шапки, а кнопки
 * строк и `ActionButton` набора рисуют экшоны через порт.
 */
export const MetricComponent = observer(function MetricComponent(props: {
  object: MapObject;
  metric: MapMetric;
  value: MetricValue | undefined;
  data: unknown;
  build: DisplayBuild | undefined;
  /** Раскрытие деревьев набора по `id` — запоминает сетка. */
  treeOf: (id: string) => TreeOpen;
}) {
  const port = useMetricsPort();

  return (
    <ComponentDisplay
      build={props.build}
      invalid={props.value?.invalid}
      display={{
        data: props.data,
        object: {
          address: props.object.address,
          name: props.object.name,
          path: props.object.path,
          props: props.object.props,
        },
        metric: {
          key: props.metric.key,
          address: props.metric.address,
          label: props.metric.config.label ?? props.metric.key,
          busy: props.value?.busy === true,
          ...(props.value?.updatedAt === undefined ? {} : { updatedAt: props.value.updatedAt }),
          ...(props.value?.ok === undefined ? {} : { ok: props.value.ok }),
        },
        open: (link: string) => port.open(link),
        actions: port.actions.list(props.object),
        run: (action: string, inputs?: Record<string, unknown>) =>
          port.actions.run(props.object, action, inputs),
      }}
      links={{
        onOpen: (link: string) => port.open(link),
        ...(port.openObjectTab ? { onOpenTab: port.openObjectTab } : {}),
        renderRowAction: (action) => <port.actions.Row object={props.object} action={action} />,
        renderActionButton: (action, label) => (
          <port.actions.Button object={props.object} action={action} label={label} />
        ),
        treeOpen: props.treeOf,
      }}
    />
  );
});
