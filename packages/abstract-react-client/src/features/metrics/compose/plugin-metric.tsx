import type { ComponentBuild, MapMetric, MapObject } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import type { Feed } from "../../../lib/store/feed.ts";
import { useLocalStore } from "../../../lib/store/use-local-store.ts";
import { useWatch } from "../../../lib/store/use-watch.ts";
import { PluginCalls } from "../adapters/plugin-calls.ts";
import { ProvidePluginKit, useMetricsPort } from "../ports.tsx";
import { ComponentDisplay } from "./component-display.tsx";

/**
 * Метрика-компонент: сама метрика — `.tsx`, который зовёт плагины. Значения от платформы у неё
 * нет, поэтому пропсы — её `params`, объект и она сама; данные компонент берёт хуками набора.
 * Рамки нет: что показать, пока данных нет, решает компонент (готовые виды плагина `views`
 * рисуют её сами).
 *
 * Набор получает от клетки её объект — у него `useAction` ищет экшон по ключу. Ссылки — не её:
 * `useNavigation` даёт сетка.
 */
export function PluginMetric(props: {
  object: MapObject;
  metric: MapMetric;
  /** Сборка компонента — ресурс: подписана на неё клетка, пока она на экране. */
  build: Feed<ComponentBuild>;
  /** Таб одной метрики: открывать его ещё раз незачем. */
  solo?: boolean | undefined;
  compact?: boolean | undefined;
}) {
  const port = useMetricsPort();
  const bridge = useBridgeClient();
  const calls = useLocalStore(
    () => new PluginCalls(bridge, port.ref, props.metric.config.component ?? ""),
    [props.metric.config.component, port.ref.mapPath],
  );
  useWatch(props.build);

  return (
    <ProvidePluginKit kit={calls}>
      <ComponentDisplay
        build={props.build.value}
        display={{
          params: port.params(props.object, props.metric),
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
          },
          compact: props.compact === true,
          ...(port.openTab && props.solo !== true
            ? { openTab: () => port.openTab?.(props.metric) }
            : {}),
        }}
        links={{ object: props.object }}
      />
    </ProvidePluginKit>
  );
}
