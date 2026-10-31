import { useBridgeClient } from "../ports/bridge.tsx";
import { useHost } from "../services/host/ports.tsx";
import { MapView } from "../services/map/index.ts";
import { useLocalStore } from "../lib/store/use-local-store.ts";
import { useWatch } from "../lib/store/use-watch.ts";
import type { Watchable } from "../lib/store/reactive.ts";
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
import {
  ActionFormComponent,
  CallMemory,
  ComponentBuilds,
  Markdown,
  MetricGrid,
  metricParams,
  ProvideMetrics,
  type ParamsOverride,
} from "../features/metrics/index.ts";
import {
  ActionFormHost,
  ActionRunner,
  ActionsStore,
  Launcher,
  ObjectActionMenu,
  ProvideActionForm,
  ProvideActions,
} from "../features/actions/index.ts";
import { ObjectRuns, ProvideRuns, RunsScreen } from "../features/runs/index.ts";
import {
  DirectiveArchive,
  DirectiveMenu,
  ProvideDirectives,
} from "../features/directives/index.ts";
import { ObjectCard, ProvideObjectCard } from "../features/object-card/index.ts";
import { MetaScreen, ProvideMeta } from "../features/meta/index.ts";
import { ScreenFocus, type FocusTarget } from "../features/focus/index.ts";

type Ref = { mapPath: string; basePath: string; name: string };

/** Что где стоит на экране объекта: какие фичи экран расставляет по своим местам. */
const Slots: ScreenSlots = {
  Metrics: MetricGrid,
  Directives: DirectiveMenu,
  Meta: MetaScreen,
  Runs: RunsScreen,
  ActionMenu: ObjectActionMenu,
  ActionForm: ActionFormHost,
  Markdown,
};

/**
 * Вид объекта — сборка фич экрана (решение 0042). Здесь заводятся сторы, которые живут столько
 * же, сколько вид: карта (объекты с сервера), экран с историей, прогоны открытого объекта, экшоны, терминалы, —
 * и каждой фиче подкладывается её порт. Фичи друг друга не знают: что метрикам нужно от экшонов
 * и прогонов, стыкуется здесь.
 */
export function ObjectView(props: {
  mapConfig: Ref;
  start?: StartAt | undefined;
  /** Где вид хранит историю — решение 0036; без неё история начинается со `start`. */
  history?: History | undefined;
  onHistory?: ((history: History) => void) | undefined;
  /** Просьбы хоста перейти к объекту — кнопка «к объекту» в файле директивы; только в сайдбаре. */
  focus?:
    | (Watchable & { pendingFor(mapPath: string): FocusTarget | undefined; take(): void })
    | undefined;
  /** Страница снимка: `params` снимаемой метрики поверх её конфига. */
  override?: ParamsOverride | undefined;
}) {
  const bridge = useBridgeClient();
  const host = useHost();
  // Что умеет хост, приходит ответом: вид подписан на хост, иначе вопрос и не задаётся.
  useWatch(host);
  const map = useLocalStore(
    () => new MapView(bridge, props.mapConfig),
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
    () => new ObjectRuns(bridge, props.mapConfig.mapPath, () => screen.object.address, screen),
    [screen],
  );
  const actions = useLocalStore(
    () => new ActionsStore(new Launcher(new ActionRunner(bridge, props.mapConfig)), runs, map),
    [runs],
  );
  const terminals = useLocalStore(() => new Terminals(bridge, props.mapConfig), [map]);
  // Сборки компонентов — на весь вид: смена вкладки и переход к объекту их не теряют.
  const builds = useLocalStore(() => new ComponentBuilds(bridge, props.mapConfig), [map]);
  // Последние ответы плагинов компонентам — тоже на весь вид: вернувшаяся клетка не прыгает.
  const calls = useLocalStore(() => new CallMemory(), [map]);
  useLocalStore(
    () => new ScreenFocus(props.focus, props.mapConfig.mapPath, map, screen),
    [props.focus, screen],
  );

  return (
    <ProvideRuns runs={runs}>
      <ProvideActions actions={actions}>
        <ProvideActionForm view={ActionFormComponent}>
          <ProvideMetrics
            port={{
              ref: props.mapConfig,
              builds,
              calls,
              params: (object, metric) => metricParams(object, metric, props.override),
              goTo: (address) => screen.go(address),
              ...(screen.tabs
                ? {
                    openTab: (metric) => screen.openMetricTab(metric),
                    openObjectTab: (link: string) => screen.openObjectTab(link),
                  }
                : {}),
              actions,
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
                  object: (address) => map.object(address),
                  feed: (address) => map.feed(address),
                  Directives: DirectiveArchive,
                }}
              >
                <ProvideObjectCard
                  port={{
                    object: (address) => map.object(address),
                    feed: (address) => map.feed(address),
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
              </ProvideMeta>
            </ProvideDirectives>
          </ProvideMetrics>
        </ProvideActionForm>
      </ProvideActions>
    </ProvideRuns>
  );
}
