import type { MapMetric, MapObject } from "@mapward/core";
import { useDisplayBuild } from "../adapters/use-display-build.ts";
import type { Collected } from "../adapters/use-metrics.ts";
import { ComponentDisplay } from "../ui/component-display.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Ячейка со своим компонентом — решение 0037: подписка на сборку и пропсы, которые компонент
 * получает. Экшоны объекта потом добавятся сюда же полем.
 */
export function MetricComponent(props: {
  mapRef: Ref;
  object: MapObject;
  metric: MapMetric;
  value: Collected | undefined;
  data: unknown;
  onOpen: (link: string) => void;
  onOpenTab?: (link: string) => void;
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
      }}
      links={
        props.onOpenTab === undefined
          ? { onOpen: props.onOpen }
          : { onOpen: props.onOpen, onOpenTab: props.onOpenTab }
      }
    />
  );
}
