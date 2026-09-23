import { useId, type ReactNode } from "react";
import type { Layout, LinkNode, MapAction, MapMetric, MapObject, MapRelation } from "@mapward/core";
import type { DisplayAction } from "@mapward/display";
import { ago, toDisplay } from "../pure-model/display.ts";
import { DEFAULT_TREE, treeOpen, type OpenFolders } from "../pure-model/tree-open.ts";
import { cellAttribute, planGrid, soloGrid } from "../pure-model/grid.ts";
import { useMetrics } from "../adapters/use-metrics.ts";
import { useViewState } from "../../../../services/state/index.ts";
import { Display, type RenderRowAction } from "../ui/displays.tsx";
import type { KitLinks } from "../ui/display-kit.tsx";
import { MetricCell } from "../ui/metric-cell.tsx";
import { MetricComponent } from "./metric-component.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Экшоны в сетке — решение 0038. Сами кнопки и запуск рисует `map-object/compose`: он знает
 * прогоны и форму, а сетке достаточно сказать, где кнопка стоит.
 */
export type GridActions = {
  /** Экшоны, которые раскладка может поставить в клетку: ключ в `areas`, как у метрики. */
  cells: MapAction[];
  renderCell: (action: MapAction) => ReactNode;
  /** Кнопка строки списка и узла дерева. */
  renderRow: RenderRowAction;
  /** Для компонента-дисплея: экшоны пропсом, запуск и кнопка набора. */
  list: DisplayAction[];
  run: (action: string, inputs?: Record<string, unknown>) => void;
  renderButton: NonNullable<KitLinks["renderActionButton"]>;
};

export function MetricGrid(props: {
  mapRef: Ref;
  object: MapObject;
  /** Метрики открытой вкладки: что показать, решает группа, а не сетка — решение 0025. */
  metrics: MapMetric[];
  /** Раскладка вкладки: своя у группы, иначе объекта. */
  layout?: Layout;
  /** Имя открытой вкладки — оно же едет в подписку: закрытая вкладка не собирается. */
  group?: string;
  /**
   * Одна метрика во всю ширину — таб метрики (решение 0026). Сетка тогда не раскладывается:
   * раскладывать нечего, и лишние клетки съели бы место, ради которого таб и открывали.
   */
  solo?: string;
  onOpen: (link: string) => void;
  /** Открыть метрику отдельным табом; хост не умеет табы — параметра нет, и иконок тоже. */
  onOpenTab?: (metric: MapMetric) => void;
  /** Открыть табом объект, на который ведёт ссылка внутри метрики — то же решение 0026. */
  onOpenObjectTab?: (link: string) => void;
  /** Красная точка метрики ведёт на экран прогонов — решение 0038. */
  onRuns?: (metric: MapMetric) => void;
  actions?: GridActions;
  /** Карту детей рисует соседний подмодуль, а сводит их вместе `map-object/compose` (0015). */
  renderMap: (
    map: { nodes: LinkNode[]; relations: MapRelation[] },
    metricAddress: string,
  ) => ReactNode;
}) {
  // Правила сетки лежат под своим классом: две сетки на экране не должны задевать друг друга.
  const scope = `mw-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const solo = props.solo === undefined ? undefined : soloGrid(props.solo);
  const plan = solo
    ? undefined
    : planGrid(
        props.layout,
        // Ключ экшона раскладка называет так же, как ключ метрики, и клетка у него своя.
        [
          ...props.metrics.map((metric) => metric.key),
          ...(props.actions?.cells ?? []).map((action) => action.key),
        ],
        scope,
      );
  const placed = solo?.placed ?? plan?.placed;

  /**
   * Раскладка есть — показываются метрики, которые в ней названы, и только они (решение 0029).
   * Отбор идёт до подписки: невидимая метрика не собирается, как метрика вне вкладки.
   */
  const metrics = placed ? props.metrics.filter((metric) => placed.has(metric.key)) : props.metrics;
  // Без раскладки экшонов в сетке нет: стопкой метрик их ставить некуда, они живут в шапке.
  const cellActions = plan
    ? (props.actions?.cells ?? []).filter((a) => plan.placed.has(a.key))
    : [];
  const actions = props.actions;

  const { values, busy, run } = useMetrics(props.mapRef, props.object.address, metrics, {
    ...(props.group === undefined ? {} : { group: props.group }),
    ...(props.solo === undefined ? {} : { solo: props.solo }),
  });
  // Hiding is a per-person convenience: the editor remembers it, the repository never sees it.
  // What the person folded by hand wins over the metric's own `collapsed` — decision 0010.
  const [folded, setFolded] = useViewState<Record<string, boolean>>(
    `folded:${props.object.address}`,
    {},
  );
  // Раскрытые папки деревьев — той же природы: у человека, на объект и метрику, в сетке и в табе
  // метрики одни и те же.
  const [openFolders, setOpenFolders, foldersReady] = useViewState<Record<string, OpenFolders>>(
    `tree-open:${props.object.address}`,
    {},
  );
  const openTree = (key: string) => (tree: string) =>
    treeOpen(openFolders[key] ?? {}, foldersReady, tree, (next) =>
      setOpenFolders({ ...openFolders, [key]: next }),
    );
  const now = Date.now();

  const isFolded = (key: string, collapsed: boolean | undefined) =>
    // В табе одной метрики свёрнутость не спрашивается: таб открыт ради того, чтобы её видеть.
    props.solo === key ? false : (folded[key] ?? collapsed ?? false);
  const toggle = (key: string, collapsed: boolean | undefined) =>
    setFolded({ ...folded, [key]: !isFolded(key, collapsed) });

  /**
   * Высоту сетке код не задаёт (решение 0033): она растёт по содержимому, а прокручивается
   * область вокруг. Растянуть её на всю высоту раскладка может сама — `height: 100%` в `style`.
   * Таб одной метрики — исключение: там метрика и есть весь экран.
   */
  return (
    <div
      // `content-start` прижимает ряды кверху, когда сетке досталось больше места, чем нужно
      // метрикам: иначе css растягивает ряды `auto` на весь остаток. Ряд `1fr` это не трогает.
      className={`${scope} grid content-start gap-2 p-2 pl-6 ${solo ? "h-full min-h-0" : ""}`}
      {...(solo
        ? { style: { gridTemplateColumns: solo.columns, gridTemplateRows: solo.rows } }
        : {})}
    >
      {plan && <style>{plan.css}</style>}
      {metrics.map((metric) => {
        const value = values[metric.address];
        return (
          <MetricCell
            key={metric.address}
            // Место клетке назначает css раскладки, находя её по ключу метрики.
            cell={{ [cellAttribute]: metric.key }}
            label={metric.config.label ?? metric.key}
            // `updatedAt` — время получения содержимого, а не чтения (0013), поэтому время
            // осмысленно и без файлового кэша: значение живёт в сторе и переживает уход
            // с объекта. Нет значения — `ago` сам вернёт ничего.
            freshness={ago(value?.updatedAt, now)}
            ok={value?.ok}
            busy={busy.has(metric.address)}
            hidden={isFolded(metric.key, metric.config.collapsed)}
            onRefresh={() => run(metric)}
            onToggle={() => toggle(metric.key, metric.config.collapsed)}
            {...(props.onRuns === undefined ? {} : { onRuns: () => props.onRuns?.(metric) })}
            {...(props.onOpenTab === undefined || props.solo !== undefined
              ? {}
              : { onOpenTab: () => props.onOpenTab?.(metric) })}
          >
            <Display
              data={toDisplay(metric.config.display?.kind, value?.data)}
              collected={value?.data !== undefined}
              // Снимка ещё нет или метрика ещё поднимается — это загрузка, а не «не собиралась».
              pending={value === undefined || value.loading === true}
              empty={metric.config.display?.empty}
              onOpen={props.onOpen}
              {...(props.onOpenObjectTab === undefined ? {} : { onOpenTab: props.onOpenObjectTab })}
              renderMap={(map) => props.renderMap(map, metric.address)}
              {...(actions === undefined ? {} : { renderAction: actions.renderRow })}
              treeOpen={openTree(metric.key)(DEFAULT_TREE)}
              renderComponent={(data) => (
                <MetricComponent
                  mapRef={props.mapRef}
                  object={props.object}
                  metric={metric}
                  value={value}
                  data={data}
                  onOpen={props.onOpen}
                  {...(props.onOpenObjectTab === undefined
                    ? {}
                    : { onOpenTab: props.onOpenObjectTab })}
                  actions={actions?.list ?? []}
                  onRun={actions?.run ?? (() => {})}
                  treeOpen={openTree(metric.key)}
                  {...(actions === undefined
                    ? {}
                    : {
                        renderRowAction: actions.renderRow,
                        renderActionButton: actions.renderButton,
                      })}
                />
              )}
            />
          </MetricCell>
        );
      })}
      {cellActions.map((action) => (
        // Та же метка, что у клетки метрики: место назначает css раскладки.
        <div key={action.address} {...{ [cellAttribute]: action.key }} className="min-w-0">
          {actions?.renderCell(action)}
        </div>
      ))}
    </div>
  );
}
