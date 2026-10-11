import { observer } from "mobx-react-lite";
import type { Layout, MapMetric, MapObject } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useViewStates } from "../../../services/state/ports.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { DisplayBuilds } from "../adapters/display-builds.ts";
import { MetricValues } from "../adapters/metric-values.ts";
import { GridStore, type GridCell } from "../model/grid-store.ts";
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
  CompactCell,
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
  /** Компактный вид — превью объекта: клетки без шапки, имя и кнопки при наведении. */
  compact?: boolean | undefined;
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
          compact: props.compact,
          cells: () => port.actions.cells(props.object),
        },
        values,
        views,
      ),
    [props.object, props.metrics, props.layout, props.solo, props.compact, values],
  );

  return (
    <GridFrame scope={grid.scope} css={grid.css} solo={grid.soloStyle} compact={grid.isCompact}>
      {grid.cells.map((cell) =>
        grid.isCompact ? (
          <CompactCell
            key={cell.metric.address}
            cellKey={cell.metric.key}
            badge={<Status cell={cell} />}
            label={cell.label}
            overlay={<Controls grid={grid} cell={cell} />}
          >
            <Content object={props.object} cell={cell} builds={builds} />
          </CompactCell>
        ) : (
          <MetricCell
            key={cell.metric.address}
            cellKey={cell.metric.key}
            hidden={cell.hidden}
            header={
              <CellHeader>
                <CellFold hidden={cell.hidden} onToggle={() => grid.toggle(cell.metric)} />
                <Controls grid={grid} cell={cell} />
              </CellHeader>
            }
          >
            <Content object={props.object} cell={cell} builds={builds} />
          </MetricCell>
        ),
      )}
      {grid.actions.map((action) => (
        <ActionCell key={action.address} cell={action.key}>
          <port.actions.Cell action={action} />
        </ActionCell>
      ))}
    </GridFrame>
  );
});

/** Состояние метрики: считается, упала. В компактном виде — значком в углу клетки. */
const Status = observer(function Status(props: { cell: GridCell }) {
  const port = useMetricsPort();
  return (
    <>
      {props.cell.busy && <CellBusy />}
      {props.cell.failed && <CellFailed onRuns={() => port.openRuns(props.cell.metric)} />}
    </>
  );
});

/** Имя и кнопки метрики: строкой шапки, а в компактном виде — плашкой при наведении. */
const Controls = observer(function Controls(props: { grid: GridStore; cell: GridCell }) {
  const port = useMetricsPort();
  return (
    <>
      <CellLabel
        label={props.cell.label}
        onOpenTab={
          port.openTab && !props.grid.isSolo ? () => port.openTab?.(props.cell.metric) : undefined
        }
      />
      {port.openTab && !props.grid.isSolo && (
        <CellTabButton onOpenTab={() => port.openTab?.(props.cell.metric)} />
      )}
      <Status cell={props.cell} />
      <CellRefresh onRefresh={() => props.grid.refresh(props.cell.metric)} />
      <Freshness grid={props.grid} cell={props.cell} />
    </>
  );
});

/** Значение метрики — дисплеем; карту детей, экшоны и карточки рисуют их фичи. */
const Content = observer(function Content(props: {
  object: MapObject;
  cell: GridCell;
  builds: DisplayBuilds;
}) {
  const port = useMetricsPort();
  return (
    <Display
      data={props.cell.data}
      collected={props.cell.collected}
      pending={props.cell.pending}
      empty={props.cell.empty}
      onOpen={(link) => port.open(link)}
      onOpenTab={port.openObjectTab}
      renderMap={(map) => <port.ObjectsMap map={map} address={props.cell.metric.address} />}
      renderAction={(action) => <port.actions.Row object={props.object} action={action} />}
      renderMenu={(actions, row) => (
        <port.actions.Menu object={props.object} actions={actions}>
          {row}
        </port.actions.Menu>
      )}
      renderObject={(item) => <port.Card item={item} />}
      treeOpen={props.cell.tree}
      renderComponent={(data) => (
        <MetricComponent
          object={props.object}
          metric={props.cell.metric}
          value={props.cell.value}
          data={data}
          build={props.builds.of(props.cell.metric.address)}
          treeOf={props.cell.treeOf}
        />
      )}
    />
  );
});

/**
 * Время сбора — своим наблюдателем: часы сетки тикают раз в минуту, и перерисоваться от них
 * должна надпись, а не вся сетка (решение 0045).
 */
const Freshness = observer(function Freshness(props: { grid: GridStore; cell: GridCell }) {
  return <CellFreshness text={props.grid.freshness(props.cell)} />;
});
