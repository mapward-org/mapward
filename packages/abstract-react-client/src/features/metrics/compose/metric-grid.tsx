import { observer } from "mobx-react-lite";
import type { Layout, MapMetric, MapObject } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useViewStates } from "../../../services/state/ports.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { DisplayBuilds } from "../adapters/display-builds.ts";
import { MetricValues } from "../adapters/metric-values.ts";
import { GridStore } from "../model/grid-store.ts";
import { useMetricsPort } from "../ports.tsx";
import { ActionCell, GridFrame } from "../ui/grid-frame.tsx";
import {
  CellBusy,
  CellFailed,
  CellFold,
  CellFreshness,
  CellHeader,
  CellLabel,
  CellRefresh,
  CellTabButton,
  MetricCell,
} from "../ui/metric-cell.tsx";
import { Display } from "./displays.tsx";
import { MetricComponent } from "./metric-component.tsx";

/**
 * Сетка метрик объекта — решения 0029 и 0033. Что показать, решает вкладка, а не сетка
 * (решение 0025); как клетки лежат, решает раскладка. Экшоны в клетках, кнопки строк и карту
 * детей рисуют их фичи — сетка получает их портом (решение 0042).
 */
export const MetricGrid = observer(function MetricGrid(props: {
  object: MapObject;
  /** Метрики открытой вкладки. */
  metrics: MapMetric[];
  /** Раскладка вкладки: своя у группы, иначе объекта. */
  layout?: Layout | undefined;
  /** Имя открытой вкладки — оно же едет в подписку: закрытая вкладка не собирается. */
  group?: string | undefined;
  /** Одна метрика во всю ширину — таб метрики (решение 0026). */
  solo?: string | undefined;
}) {
  const port = useMetricsPort();
  const bridge = useBridgeClient();
  const views = useViewStates();
  const values = useLocalStore(
    () =>
      new MetricValues(bridge, port.ref, () => ({
        address: props.object.address,
        group: props.group,
        solo: props.solo,
      })),
    [props.object, props.group, props.solo],
  );
  const builds = useLocalStore(() => new DisplayBuilds(bridge, port.ref), [port.ref.mapPath]);
  const grid = useLocalStore(
    () =>
      new GridStore(
        {
          object: props.object,
          metrics: props.metrics,
          layout: props.layout,
          solo: props.solo,
          cells: () => port.actions.cells(props.object),
        },
        values,
        views,
      ),
    [props.object, props.metrics, props.layout, props.solo, values],
  );

  return (
    <GridFrame scope={grid.scope} css={grid.css} solo={grid.soloStyle}>
      {grid.cells.map((cell) => (
        <MetricCell
          key={cell.metric.address}
          cellKey={cell.metric.key}
          hidden={cell.hidden}
          header={
            <CellHeader>
              <CellFold hidden={cell.hidden} onToggle={() => grid.toggle(cell.metric)} />
              <CellLabel
                label={cell.label}
                onOpenTab={
                  port.openTab && !grid.isSolo ? () => port.openTab?.(cell.metric) : undefined
                }
              />
              {port.openTab && !grid.isSolo && (
                <CellTabButton onOpenTab={() => port.openTab?.(cell.metric)} />
              )}
              {cell.busy && <CellBusy />}
              {cell.failed && <CellFailed onRuns={() => port.openRuns(cell.metric)} />}
              <CellRefresh onRefresh={() => grid.refresh(cell.metric)} />
              <CellFreshness text={cell.freshness} />
            </CellHeader>
          }
        >
          <Display
            data={cell.data}
            collected={cell.collected}
            pending={cell.pending}
            empty={cell.empty}
            onOpen={(link) => port.open(link)}
            onOpenTab={port.openObjectTab}
            renderMap={(map) => <port.ChildrenMap map={map} address={cell.metric.address} />}
            renderAction={(action) => <port.actions.Row object={props.object} action={action} />}
            treeOpen={cell.tree}
            renderComponent={(data) => (
              <MetricComponent
                object={props.object}
                metric={cell.metric}
                value={cell.value}
                data={data}
                build={builds.of(cell.metric.address)}
                treeOf={cell.treeOf}
              />
            )}
          />
        </MetricCell>
      ))}
      {grid.actions.map((action) => (
        <ActionCell key={action.address} cell={action.key}>
          <port.actions.Cell action={action} />
        </ActionCell>
      ))}
    </GridFrame>
  );
});
