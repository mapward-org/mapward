import type { MapMetric, MapObject, MetricGroup } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useLocalStore } from "../../../lib/store/use-local-store.ts";
import { useWatch } from "../../../lib/store/use-watch.ts";
import type { ComponentBuilds } from "../adapters/component-builds.ts";
import { Navigation } from "../adapters/navigation.ts";
import { GroupStore } from "../model/group-store.ts";
import { ProvideNavigation, useMetricsPort } from "../ports.tsx";
import { GridFrame, LayoutFrame } from "../ui/grid-frame.tsx";
import { BareCell } from "../ui/metric-cell.tsx";
import { ComponentDisplay } from "./component-display.tsx";
import { PluginMetric } from "./plugin-metric.tsx";

/**
 * Метрики группы — решения 0025, 0029 и 0033. Что показать, решает группа; как поставить —
 * её раскладка, компонент из поля `layout`: он получает метрики уже нарисованными и ставит их
 * сам. Раскладки нет — вертикальный список в порядке группы. Экшоны, кнопки строк и карту детей
 * рисуют их фичи — группа получает их портом (решение 0042). Навигация набора (`useNavigation`)
 * заводится здесь: плагину `navigation` нужна карта, а переходу — экран.
 */
export function MetricGrid(props: {
  object: MapObject;
  /** Метрики открытой вкладки, в порядке группы. */
  metrics: MapMetric[];
  /** Открытая группа: её раскладка ставит метрики. У объекта без групп её нет. */
  group?: MetricGroup | undefined;
  /** Одна метрика во всю ширину — таб метрики (решение 0026). */
  solo?: string | undefined;
  /** Компактный вид — превью объекта: клетки без шапки, имя и кнопки при наведении. */
  compact?: boolean | undefined;
}) {
  const port = useMetricsPort();
  const bridge = useBridgeClient();
  const builds = port.builds;
  // Табы хост сообщает ответом: появились — навигация заводится заново, уже с ними.
  const navigation = useLocalStore(
    () => new Navigation(bridge, port.ref, port),
    [bridge, port.ref.mapPath, port.openObjectTab === undefined],
  );
  const group = useLocalStore(
    () =>
      new GroupStore(
        {
          object: props.object,
          metrics: props.metrics,
          group: props.group,
          solo: props.solo,
          compact: props.compact,
        },
        builds,
      ),
    [props.object, props.metrics, props.group, props.solo, props.compact, builds],
  );

  return (
    <ProvideNavigation navigation={navigation}>
      <Grid group={group} builds={builds} object={props.object} />
    </ProvideNavigation>
  );
}

/** Раскладка группы или вертикальный список, если раскладки нет. */
function Grid(props: { group: GroupStore; builds: ComponentBuilds; object: MapObject }) {
  const group = props.group;
  const builds = props.builds;
  useWatch(group);
  return group.mode === "layout" ? (
    <LayoutFrame compact={group.isCompact}>
      <ComponentDisplay
        build={group.layoutBuild}
        display={
          group.layoutProps((metric) => (
            <MetricNode key={metric.address} group={group} metric={metric} builds={builds} />
          )) ?? {}
        }
        links={{ object: props.object }}
      />
    </LayoutFrame>
  ) : (
    <GridFrame solo={group.soloStyle} compact={group.isCompact}>
      {group.metrics.map((metric) => (
        <MetricNode key={metric.address} group={group} metric={metric} builds={builds} />
      ))}
    </GridFrame>
  );
}

/**
 * Нарисованная метрика — то, что раскладка ставит по местам. Любая метрика — компонент, и рамку
 * она рисует себе сама: готовые виды — компоненты плагина `views`. Подписка на значение живёт
 * в компоненте, пока он смонтирован: что раскладка не поставила, то и не собирается.
 */
function MetricNode(props: { group: GroupStore; metric: MapMetric; builds: ComponentBuilds }) {
  useWatch(props.group);
  return (
    <BareCell compact={props.group.isCompact}>
      <PluginMetric
        object={props.group.object}
        metric={props.metric}
        build={props.builds.of(props.metric.address)}
        solo={props.group.isSolo}
        compact={props.group.isCompact}
      />
    </BareCell>
  );
}
