import type { MapMetric, MapObject } from "@mapward/core";
import type { DisplayAction } from "@mapward/display";
import { useDisplayBuild } from "../adapters/use-display-build.ts";
import type { Collected } from "../adapters/use-metrics.ts";
import { ComponentDisplay } from "../ui/component-display.tsx";
import type { KitLinks } from "../ui/display-kit.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Ячейка со своим компонентом — решение 0037: подписка на сборку и пропсы, которые компонент
 * получает. Экшоны объекта и запуск — решение 0038: `run` идёт тем же путём, что кнопка шапки,
 * а кнопки строк и `ActionButton` набора рисует сетка через контекст.
 */
export function MetricComponent(props: {
  mapRef: Ref;
  object: MapObject;
  metric: MapMetric;
  value: Collected | undefined;
  data: unknown;
  onOpen: (link: string) => void;
  onOpenTab?: (link: string) => void;
  actions: DisplayAction[];
  onRun: (action: string, inputs?: Record<string, unknown>) => void;
  renderRowAction?: KitLinks["renderRowAction"];
  renderActionButton?: KitLinks["renderActionButton"];
  /** Раскрытие деревьев набора по `id` — запоминает сетка. */
  treeOpen?: KitLinks["treeOpen"];
}) {
  const build = useDisplayBuild(props.mapRef, props.metric.address);
  const { object, metric, value } = props;

  return (
    <ComponentDisplay
      build={build}
      {...(value?.invalid === undefined ? {} : { invalid: value.invalid })}
      display={{
        data: props.data,
        object: {
          address: object.address,
          name: object.name,
          path: object.path,
          props: object.props,
        },
        metric: {
          key: metric.key,
          address: metric.address,
          label: metric.config.label ?? metric.key,
          busy: value?.busy === true,
          ...(value?.updatedAt === undefined ? {} : { updatedAt: value.updatedAt }),
          ...(value?.ok === undefined ? {} : { ok: value.ok }),
        },
        open: props.onOpen,
        actions: props.actions,
        run: props.onRun,
      }}
      links={{
        onOpen: props.onOpen,
        ...(props.onOpenTab === undefined ? {} : { onOpenTab: props.onOpenTab }),
        ...(props.renderRowAction === undefined ? {} : { renderRowAction: props.renderRowAction }),
        ...(props.renderActionButton === undefined
          ? {}
          : { renderActionButton: props.renderActionButton }),
        ...(props.treeOpen === undefined ? {} : { treeOpen: props.treeOpen }),
      }}
    />
  );
}
