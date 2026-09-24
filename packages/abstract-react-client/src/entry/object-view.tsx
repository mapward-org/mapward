import { observer } from "mobx-react-lite";
import { LiveFiles } from "@mapward/core";
import { useBridgeClient } from "../ports/bridge.tsx";
import { useHost } from "../services/host/ports.tsx";
import { bridgeFiles, MapView, reloadMap } from "../services/map/index.ts";
import { MapState } from "../services/state/index.ts";
import { useLocalStore } from "../lib/mobx/use-local-store.ts";
import {
  CardTerminalMenu,
  ObjectScreen,
  ProvideScreenSlots,
  ProvideTerminals,
  ScreenStore,
  Terminals,
  type History,
  type ScreenSlots,
  type StartAt,
} from "../features/object-screen/index.ts";
import { Markdown, MetricGrid, ProvideMetrics } from "../features/metrics/index.ts";
import {
  ActionFormHost,
  ActionRunner,
  ActionsStore,
  CellActionButton,
  KitActionButton,
  Launcher,
  ObjectActionMenu,
  ProvideActions,
  RowActionButtonFor,
} from "../features/actions/index.ts";
import { ObjectRuns, ProvideRuns, RunsScreen } from "../features/runs/index.ts";
import {
  DirectiveArchive,
  DirectiveMenu,
  ObjectDirectives,
  ProvideDirectives,
} from "../features/directives/index.ts";
import { ObjectCard, ProvideObjectCard } from "../features/object-card/index.ts";
import { MetaScreen, ProvideMeta } from "../features/meta/index.ts";
import { ChildrenMapView, ProvideChildrenMap } from "../features/children-map/index.ts";

type Ref = { mapPath: string; basePath: string; name: string };

/** Что где стоит на экране объекта: какие фичи экран расставляет по своим местам. */
const Slots: ScreenSlots = {
  Metrics: MetricGrid,
  Directives: ObjectDirectives,
  Meta: MetaScreen,
  Runs: RunsScreen,
  ActionMenu: ObjectActionMenu,
  ActionForm: ActionFormHost,
  Markdown,
};

/**
 * Вид объекта — сборка фич экрана (решение 0042). Здесь заводятся сторы, которые живут столько
 * же, сколько вид: живая карта, экран с историей, прогоны открытого объекта, экшоны, терминалы,
 * положение узлов, — и каждой фиче подкладывается её порт. Фичи друг друга не знают: что
 * метрикам нужно от экшонов и прогонов, стыкуется здесь.
 */
export const ObjectView = observer(function ObjectView(props: {
  mapConfig: Ref;
  start?: StartAt | undefined;
  /** Где вид хранит историю — решение 0036; без неё история начинается со `start`. */
  history?: History | undefined;
  onHistory?: ((history: History) => void) | undefined;
}) {
  const bridge = useBridgeClient();
  const host = useHost();
  const map = useLocalStore(
    () =>
      new MapView(new LiveFiles(bridgeFiles(bridge, props.mapConfig)), props.mapConfig, () =>
        reloadMap(bridge, props.mapConfig),
      ),
    [props.mapConfig.mapPath, props.mapConfig.basePath, props.mapConfig.name],
  );
  const screen = useLocalStore(
    () =>
      new ScreenStore(
        map,
        host,
        props.mapConfig,
        { history: props.history, at: props.start },
        props.onHistory,
      ),
    [map],
  );
  const runs = useLocalStore(
    () => new ObjectRuns(bridge, props.mapConfig.mapPath, () => screen.object.address),
    [screen],
  );
  const actions = useLocalStore(
    () =>
      new ActionsStore(
        new Launcher(new ActionRunner(bridge, props.mapConfig)),
        (address) => runs.running(address),
        map.live,
      ),
    [runs],
  );
  const terminals = useLocalStore(() => new Terminals(bridge, props.mapConfig), [map]);
  const places = useLocalStore(() => new MapState(bridge, props.mapConfig.mapPath), [map]);

  return (
    <ProvideRuns runs={runs}>
      <ProvideActions actions={actions}>
        <ProvideMetrics
          port={{
            ref: props.mapConfig,
            open: (link) => screen.open(link),
            ...(screen.tabs
              ? {
                  openTab: (metric) => screen.openMetricTab(metric),
                  openObjectTab: (link: string) => screen.openObjectTab(link),
                }
              : {}),
            openRuns: (metric) => screen.openRuns(runs.last(metric.address)?.id),
            actions: {
              cells: (object) => actions.cells(object),
              list: (object) => actions.list(object),
              run: (object, action, inputs) => actions.run(object, action, inputs),
              Cell: CellActionButton,
              Row: RowActionButtonFor,
              Button: KitActionButton,
            },
            ChildrenMap: ChildrenMapView,
            Card: ObjectCard,
          }}
        >
          <ProvideDirectives
            port={{
              ask: host.can.ask,
              ...(host.can.openFile ? { open: (file) => host.open(file.path) } : {}),
              ...(host.can.terminals
                ? {
                    runStage: (object, file, stage) =>
                      terminals.runStage(object.address, file.name, stage),
                  }
                : {}),
            }}
          >
            <ProvideMeta
              port={{
                can: host.can,
                open: (path) => host.open(path),
                openVirtual: (title, text, language) => host.openVirtual(title, text, language),
                find: (address) => map.live.find(address),
                Directives: DirectiveArchive,
              }}
            >
              <ProvideChildrenMap
                port={{
                  places,
                  open: (link) => screen.open(link),
                  ...(screen.tabs ? { openTab: (link: string) => screen.openObjectTab(link) } : {}),
                  Card: ObjectCard,
                }}
              >
                <ProvideObjectCard
                  port={{
                    find: (address) => map.live.find(address),
                    open: (link) => screen.open(link),
                    ...(screen.tabs
                      ? { openTab: (link: string) => screen.openObjectTab(link) }
                      : {}),
                    Grid: MetricGrid,
                    Actions: ObjectActionMenu,
                    Directives: DirectiveMenu,
                    ...(host.can.terminals ? { Terminal: CardTerminalMenu } : {}),
                  }}
                >
                  <ProvideTerminals terminals={terminals}>
                    <ProvideScreenSlots slots={Slots}>
                      <ObjectScreen screen={screen} map={map} terminals={terminals} />
                    </ProvideScreenSlots>
                  </ProvideTerminals>
                </ProvideObjectCard>
              </ProvideChildrenMap>
            </ProvideMeta>
          </ProvideDirectives>
        </ProvideMetrics>
      </ProvideActions>
    </ProvideRuns>
  );
});
