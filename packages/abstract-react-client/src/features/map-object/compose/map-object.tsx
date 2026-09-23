import { useState } from "react";
import { observer } from "mobx-react-lite";
import { linkKind } from "@mapward/core";
import { findObject, groupLayout, groupMetrics, pickGroup } from "@mapward/core";
import type { ActionRef, MapAction, MapMetric } from "@mapward/core";
import type { DisplayAction } from "@mapward/display";
import { useMap, useMapActions } from "../adapters/use-map.ts";
import { useTerminals } from "../adapters/use-terminals.ts";
import { useCapabilities } from "../adapters/use-capabilities.ts";
import { TerminalMenu } from "../ui/terminal-menu.tsx";
import { MetricGrid, type GridActions } from "../_metrics/compose/metric-grid.tsx";
import { useActionLauncher } from "../_actions/compose/action-launcher.tsx";
import { actionLabel, keyClashes, resolveAction } from "../_actions/pure-model/actions.ts";
import { ActionButton, RowActionButton } from "../_actions/ui/action-button.tsx";
import { ActionMenu } from "../_actions/ui/action-menu.tsx";
import { RunsScreen } from "../_runs/compose/runs-screen.tsx";
import { useRuns } from "../_runs/adapters/use-runs.ts";
import { lastRun, runningCount } from "../_runs/pure-model/runs.ts";
import { ChildrenMapView } from "../_children-map/compose/children-map.tsx";
import { DirectiveList } from "../_directives/compose/directive-list.tsx";
import { DirectiveSection } from "../_directives/compose/directive-section.tsx";
import { MetaScreen } from "../_meta/compose/meta-screen.tsx";
import { Markdown } from "../_metrics/ui/markdown.tsx";
import { breadcrumbTrail } from "../pure-model/breadcrumbs.ts";
import {
  amend,
  currentScreen,
  startHistory,
  stepTarget,
  stepTo,
  visit,
  type History,
} from "../pure-model/navigation.ts";
import { activeDirectives, newestFirst } from "../pure-model/directives.ts";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { GroupTabs } from "../ui/group-tabs.tsx";
import { useTabModifier } from "../ui/tab-modifier.ts";
import {
  ActionsIcon,
  DirectivesIcon,
  IndexIcon,
  MetaIcon,
  MetricsIcon,
  NewDirectiveIcon,
  RunsIcon,
  TabIcon,
  WorkflowIcon,
} from "../ui/icons.tsx";
import { HeaderButton, ObjectHeader } from "../ui/object-header.tsx";
import { ViewTabs, type ObjectView } from "../ui/view-tabs.tsx";
import { Loading } from "../../../lib/ui/loading.tsx";
import { Section, SectionButton } from "../../../lib/ui/section.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/** Описание экшона — подсказкой на кнопке и полем для компонента, если оно есть. */
const described = (action: MapAction | undefined) =>
  action?.config.description === undefined ? {} : { description: action.config.description };

/** Иконки разделов мета-экрана: те же, что стояли на кнопках этих списков в шапке. */
const metaIcons = {
  index: IndexIcon,
  metrics: MetricsIcon,
  workflow: WorkflowIcon,
  actions: ActionsIcon,
};

/**
 * С чего вид начинается — решение 0026. В сайдбаре ни с чего: он открывается на корне карты.
 * Таб открывается на том, ради чего его завели: объект, вкладка, а иногда и одна метрика.
 */
export type StartAt = { address?: string; group?: string; metric?: string };

const startScreen = (start: StartAt | undefined) => ({
  address: start?.address ?? "mapward://",
  ...(start?.group === undefined ? {} : { group: start.group }),
  ...(start?.metric === undefined ? {} : { solo: start.metric }),
});

/**
 * `history` и `onHistory` — где вид хранит свою историю, решение 0036. Экран об этом не знает:
 * у таба она едет с тем, на чём он открыт, у сайдбара лежит в состоянии вида. Без `history`
 * история начинается со `start`.
 */
export const MapObjectView = observer(function MapObjectView(props: {
  mapConfig: Ref;
  start?: StartAt;
  history?: History;
  onHistory?: (history: History) => void;
}) {
  const map = useMap(props.mapConfig);
  const actions = useMapActions();
  /**
   * Где ты и откуда пришёл — одна история на вид, решение 0036. Шаг — объект; вкладка,
   * мета-экран и метрика во всю ширину уточняют текущий шаг и восстанавливаются вместе с ним.
   * Мета-экран — второй режим того же объекта (0024), вкладки у каждого объекта свои (0025),
   * поэтому переход на другой объект возвращает к его метрикам и первой вкладке.
   */
  const [history, setHistory] = useState<History>(
    () => props.history ?? startHistory(startScreen(props.start)),
  );
  const update = (next: History) => {
    setHistory(next);
    props.onHistory?.(next);
  };
  const { address, group, solo } = currentScreen(history);
  const meta = currentScreen(history).meta ?? false;
  /**
   * Экран прогонов — третий режим объекта, как мета-экран (решение 0038), и выбранный прогон
   * едет в истории вместе с ним.
   */
  const runsOpen = currentScreen(history).runs ?? false;
  const selectedRun = currentScreen(history).run;
  const setRuns = (value: boolean, run?: string) =>
    update(amend(history, { meta: false, runs: value, run: value ? run : undefined }));
  /** Вид объекта одним полем: мини-вкладки под шапкой переключают из любого в любой. */
  const view: ObjectView = runsOpen ? "runs" : meta ? "meta" : "metrics";
  const setView = (next: ObjectView) =>
    update(amend(history, { meta: next === "meta", runs: next === "runs", run: undefined }));
  const setGroup = (key: string) => update(amend(history, { group: key }));
  const setSolo = (key: string | undefined) => update(amend(history, { solo: key }));
  const terminals = useTerminals(props.mapConfig, address);
  // Клиент рисует только то, что хост обещал уметь — решение 0014.
  const can = useCapabilities();
  // Под ctrl подсвечивается то, что откроется табом: иконок у ссылок нет — решение 0035.
  useTabModifier(can.tabs);
  // Прогоны объекта — одна подписка на вид: ими питаются экран прогонов, счётчики у кнопок
  // экшонов и красная точка метрики. Адрес — того объекта, что покажется: пропавший ведёт к корню.
  const shownAddress = map ? (findObject(map, address) ?? map).address : address;
  const runs = useRuns(props.mapConfig.mapPath, shownAddress);
  const launcher = useActionLauncher(props.mapConfig);

  if (!map) return <Loading text="Читаем карту…" />;

  const current = findObject(map, address) ?? map;
  const path = breadcrumbTrail(map, current.address);
  const openGroup = pickGroup(current, group);
  const shown = groupMetrics(current, group);
  // Метрика таба ищется среди всех метрик объекта, а не только в открытой вкладке: таб могли
  // открыть на метрику, чью вкладку никто не называл, и пустой экран был бы враньём.
  const soloMetric = solo ? current.metrics.find((metric) => metric.key === solo) : undefined;

  // Новый шаг — обычный вид объекта: метрика во весь экран была метрикой прежнего.
  const go = (next: string) => update(visit(history, next));

  /** Стрелки — назад и вперёд по истории, к родителю ведут крошки (0036). */
  const alive = (target: string) => findObject(map, target) !== undefined;
  const arrow = (direction: -1 | 1) => {
    const index = stepTarget(history, direction, alive);
    if (index === undefined) return undefined;
    const target = currentScreen(stepTo(history, index)).address;
    return {
      name: findObject(map, target)?.name ?? target,
      address: target,
      go: () => update(stepTo(history, index)),
    };
  };

  /**
   * Ссылка ведёт туда, куда обещает схема — решение 0005: `mapward://` в объект, всё прочее
   * со схемой наружу, остальное файлом в редактор. Если хост файлы открывать не умеет, ссылка
   * просто ничего не делает (решение 0014).
   */
  const open = (link: string) => {
    const kind = linkKind(link);
    if (kind === "object") go(link);
    else if (kind === "external") actions.openExternal(link);
    else if (can.openFile) actions.open(link);
  };

  /**
   * Ctrl + клик ведёт сюда: тот же объект, но отдельным табом — решение 0026. Иконка — только
   * в шапке и у заголовка метрики (0035).
   */
  const openInTab = can.tabs
    ? (what: { address?: string; group?: string; metric?: string }) =>
        actions.openInTab({
          ...props.mapConfig,
          address: what.address ?? current.address,
          ...(what.group === undefined ? {} : { group: what.group }),
          ...(what.metric === undefined ? {} : { metric: what.metric }),
        })
    : undefined;

  /**
   * Ссылка на объект открывается табом тем же жестом, что вкладка и метрика: ctrl + клик (0026,
   * 0035). Где бы объект ни был назван — в крошках, на карте детей, в списке или дереве
   * метрики, — открывается он одинаково.
   */
  const openObjectTab = openInTab ? (link: string) => openInTab({ address: link }) : undefined;
  const objectTab = openObjectTab === undefined ? {} : { onOpenTab: openObjectTab };

  const runStage = can.terminals
    ? (file: { name: string }, stage: string) => terminals.runStage(file.name, stage)
    : undefined;
  const openDirective = can.openFile
    ? (file: { path: string }) => actions.open(file.path)
    : undefined;

  /**
   * Экшоны объекта в сетке и в дисплеях — решение 0038. Запуск у всех один: `launcher` решает,
   * нужна ли форма. Ключ, занятый и метрикой, — ошибка объекта: такой экшон в клетку не встаёт.
   */
  const clashes = keyClashes(current.metrics, current.actions);
  const running = (action: MapAction) => runningCount(runs, action.address);
  const launchRef = (ref: ActionRef) => {
    const action = resolveAction(map, current, ref.run);
    if (action) launcher.launch(action, ref.inputs ?? {}, "display");
  };
  const gridActions: GridActions = {
    cells: current.actions.filter((action) => !clashes.includes(action.key)),
    renderCell: (action) => (
      <ActionButton
        label={actionLabel(action)}
        running={running(action)}
        {...described(action)}
        onRun={() => launcher.launch(action, {}, "ui")}
      />
    ),
    // Строка дисплея называет экшон ключом или адресом; не нашёлся — ошибка этой строки.
    renderRow: (ref) => {
      const action = resolveAction(map, current, ref.run);
      return (
        <RowActionButton
          label={action ? actionLabel(action) : ref.run}
          running={action ? running(action) : 0}
          {...(action ? {} : { missing: ref.run })}
          onRun={() => launchRef(ref)}
        />
      );
    },
    list: current.actions.map((action): DisplayAction => ({
      key: action.key,
      address: action.address,
      label: actionLabel(action),
      ...described(action),
      inputs: action.config.inputs ?? {},
      running: running(action),
    })),
    run: (run, inputs) => launchRef(inputs === undefined ? { run } : { run, inputs }),
    renderButton: (ref, label) => {
      const action = resolveAction(map, current, ref.run);
      return (
        <ActionButton
          label={label ?? (action ? actionLabel(action) : ref.run)}
          running={action ? running(action) : 0}
          {...(action ? {} : { missing: ref.run })}
          {...described(action)}
          onRun={() => launchRef(ref)}
        />
      );
    },
  };

  const grid = (metrics: MapMetric[], soloKey?: string) => (
    <MetricGrid
      mapRef={props.mapConfig}
      object={current}
      metrics={metrics}
      layout={groupLayout(current, openGroup)}
      {...(openGroup === undefined ? {} : { group: openGroup.key })}
      {...(soloKey === undefined ? {} : { solo: soloKey })}
      onOpen={open}
      {...(openInTab === undefined
        ? {}
        : {
            onOpenTab: (metric: MapMetric) =>
              openInTab({ group: openGroup?.key, metric: metric.key }),
          })}
      {...(openObjectTab === undefined ? {} : { onOpenObjectTab: openObjectTab })}
      actions={gridActions}
      onRuns={(metric: MapMetric) => setRuns(true, lastRun(runs, metric.address)?.id)}
      renderMap={(childrenMap, metricAddress) => (
        <ChildrenMapView
          map={childrenMap}
          mapPath={props.mapConfig.mapPath}
          address={metricAddress}
          onOpen={open}
          {...objectTab}
        />
      )}
    />
  );

  /**
   * Таб метрики — свой экран, а не объект с одной клеткой: шапки, директив и вкладок в нём нет,
   * метрика занимает всё. Возврат к объекту — одной строкой сверху, иначе из такого таба некуда
   * идти (решение 0026).
   */
  if (soloMetric) {
    return (
      <div className="relative flex h-full flex-col pb-2">
        {launcher.form}
        <button
          type="button"
          onClick={() => setSolo(undefined)}
          title="Показать объект целиком"
          className="flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] opacity-60 hover:opacity-100"
        >
          <span className="truncate">{current.name}</span>
          <span>/</span>
          <span className="truncate">{soloMetric.config.label ?? soloMetric.key}</span>
        </button>
        <div className="min-h-0 flex-1">{grid([soloMetric], soloMetric.key)}</div>
      </div>
    );
  }

  // Мета-экран и прогоны — режимы объекта; директивы и вкладки — только в обычном виде.
  const plain = !meta && !runsOpen;

  return (
    // `relative` — для формы экшона: она ложится поверх вида, а не окном редактора (0038).
    <div className="relative flex h-full flex-col pb-2">
      {launcher.form}
      {/*
        Виды объекта — мини-вкладками в строке истории, за стрелками: сразу видно, где ты, и
        переход из любого вида в любой — один клик, а своей строки они не отнимают. Вид шагом
        истории по-прежнему не считается: стрелки ведут с объекта (0036).
      */}
      <Breadcrumbs
        trail={path}
        onGo={go}
        back={arrow(-1)}
        forward={arrow(1)}
        onReload={() => actions.reloadMap(props.mapConfig)}
        {...objectTab}
        views={
          <ViewTabs
            active={view}
            onSelect={setView}
            tabs={[
              { key: "metrics", label: "метрики", icon: MetricsIcon },
              { key: "meta", label: "об объекте", icon: MetaIcon },
              { key: "runs", label: "прогоны", icon: RunsIcon },
            ]}
          />
        }
      />

      <ObjectHeader
        name={current.name}
        prototypeName={current.prototypeName}
        actions={
          <>
            {/* Все экшоны объекта списком с поиском — решение 0038. Нет экшонов — нет кнопки. */}
            {current.actions.length > 0 && (
              <ActionMenu
                actions={current.actions}
                running={running}
                onRun={(action) => launcher.launch(action, {}, "ui")}
              />
            )}
            {can.terminals && (
              <TerminalMenu
                terminals={terminals.terminals}
                onOpen={() => terminals.open()}
                onFresh={() => terminals.open(true)}
                onShow={terminals.show}
                onClose={terminals.close}
              />
            )}
            {/*
              Шапка держит только то, что делают, а не то, что смотрят (решение 0024).
              «Новая директива» уехала к заголовку списка директив — она про него (0028).
            */}
            {openInTab && (
              <HeaderButton
                title="Открыть отдельным табом"
                onClick={() => openInTab({ group: openGroup?.key })}
              >
                {TabIcon}
              </HeaderButton>
            )}
          </>
        }
      />

      {/*
        Незакрытые директивы — на первом экране, под названием и до метрик: с ними работают
        постоянно, а выполненные лежат в мета-экране (решение 0024). Заголовок с границей
        отделяет их от метрик, а плюсик заводит новую — решение 0028.
      */}
      {/*
        Ключ, занятый и метрикой, и экшоном, — ошибка объекта (решение 0038): раскладка находит
        клетку по ключу, и вид не угадывает, что из двух туда ставить.
      */}
      {clashes.length > 0 && (
        <div className="shrink-0 px-2 pb-1 text-[11px] text-[var(--mw-errorForeground,#f85149)]">
          {clashes.length === 1 ? "ключ" : "ключи"} {clashes.join(", ")} — и у метрики, и у экшона:
          в клетке остаётся метрика, кнопкой экшон в сетку не встаёт. Переименуйте один из них.
        </div>
      )}

      {plain && (
        <div className="shrink-0 border-b border-[var(--mw-menu-border,#8884)] pb-1">
          <Section
            icon={DirectivesIcon}
            title="Директивы"
            {...(can.ask
              ? {
                  actions: (
                    <SectionButton
                      title="Новая директива"
                      onClick={() => actions.createDirective(current.path)}
                    >
                      {NewDirectiveIcon}
                    </SectionButton>
                  ),
                }
              : {})}
          >
            <DirectiveList
              compact
              empty="незакрытых нет"
              files={activeDirectives(current.directives)}
              stages={current.workflow}
              {...(openDirective === undefined ? {} : { onOpen: openDirective })}
              {...(runStage === undefined ? {} : { onRunStage: runStage })}
            />
          </Section>
        </div>
      )}

      {/* Вкладки объекта и описание открытой — решение 0025. */}
      {plain && current.metricGroups.length > 0 && (
        <>
          <GroupTabs
            groups={current.metricGroups}
            active={openGroup?.key ?? ""}
            onSelect={setGroup}
            {...(openInTab === undefined
              ? {}
              : { onOpenTab: (key: string) => openInTab({ group: key }) })}
          />
          {openGroup?.description && (
            <div className="shrink-0 px-2 pb-1 text-[11px] opacity-70">
              <Markdown text={openGroup.description} onOpen={open} />
            </div>
          )}
        </>
      )}

      {/*
        Метрики растут по содержимому, и прокручивается эта область, а шапка, директивы и
        вкладки стоят на месте (решение 0033). Она же — контейнер для `@container`-условий
        раскладки: без `container-type` ни одно из них не срабатывает.
      */}
      <div className="min-h-0 flex-1 overflow-auto" style={{ containerType: "inline-size" }}>
        {runsOpen ? (
          <RunsScreen
            mapPath={props.mapConfig.mapPath}
            runs={runs}
            selected={selectedRun}
            onSelect={(id) => setRuns(true, id)}
          />
        ) : meta ? (
          <MetaScreen
            // Другой объект — другой экран: запрос поиска с прошлого сюда не переезжает.
            key={current.address}
            map={map}
            object={current}
            can={can}
            icons={metaIcons}
            actions={actions}
            directives={(files) => (
              <DirectiveSection
                icon={DirectivesIcon}
                files={newestFirst(files)}
                stages={current.workflow}
                {...(openDirective === undefined ? {} : { onOpen: openDirective })}
                {...(runStage === undefined ? {} : { onRunStage: runStage })}
                {...(can.ask
                  ? {
                      // Спросить «точно?» умеет хост, поэтому без `ask` крестика нет:
                      // удаление — единственное необратимое, что делает этот экран (0014).
                      onRemove: (file: { name: string }) =>
                        actions.deleteDirective(current.path, file.name),
                    }
                  : {})}
              />
            )}
          />
        ) : (
          grid(shown)
        )}
      </div>
    </div>
  );
});
