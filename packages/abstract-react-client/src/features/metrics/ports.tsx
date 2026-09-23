import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { ActionRef, ChildrenMap, MapAction, MapMetric, MapObject } from "@mapward/core";
import type { DisplayAction } from "@mapward/display";
import type { TreeOpen } from "./pure-model/tree-open.ts";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Что метрикам нужно от экшонов — решение 0038: сетка говорит, где кнопка стоит, а рисуют кнопки
 * и запускают экшоны сами экшоны. Метрики их не импортируют (решение 0042).
 */
export type MetricsActions = {
  /** Экшоны объекта, которые раскладка может поставить в клетку. */
  cells(object: MapObject): MapAction[];
  /** Экшоны объекта для компонента-дисплея: пропсом, с числом идущих прогонов. */
  list(object: MapObject): DisplayAction[];
  /** Запуск из компонента-дисплея: ключом или адресом, с данными формы. */
  run(object: MapObject, action: string, inputs?: Record<string, unknown>): void;
  /** Кнопка экшона в клетке раскладки. */
  Cell: ComponentType<{ action: MapAction }>;
  /** Кнопка экшона на строке списка и узле дерева. */
  Row: ComponentType<{ object: MapObject; action: ActionRef }>;
  /** `ActionButton` набора `@mapward/display`. */
  Button: ComponentType<{ object: MapObject; action: ActionRef; label?: string | undefined }>;
};

/** Что метрикам нужно от экрана, прогонов и карты детей. */
export type MetricsPort = {
  ref: Ref;
  /** Ссылка из метрики ведёт туда, куда обещает схема (решение 0005). */
  open(link: string): void;
  /** Открыть метрику отдельным табом; хост без табов — поля нет, и иконок тоже (0026). */
  openTab?: (metric: MapMetric) => void;
  /** Открыть табом объект, на который ведёт ссылка внутри метрики. */
  openObjectTab?: (link: string) => void;
  /** Красная точка метрики ведёт на её последний прогон (решение 0038). */
  openRuns(metric: MapMetric): void;
  actions: MetricsActions;
  /** Карту детей рисует её фича. */
  ChildrenMap: ComponentType<{ map: ChildrenMap; address: string }>;
};

const MetricsContext = createContext<MetricsPort | undefined>(undefined);

export function ProvideMetrics(props: { port: MetricsPort; children: ReactNode }) {
  return <MetricsContext value={props.port}>{props.children}</MetricsContext>;
}

export function useMetricsPort(): MetricsPort {
  const port = useContext(MetricsContext);
  if (!port) throw new Error("ProvideMetrics is missing above the metric grid");
  return port;
}

/**
 * Кнопка экшона строки — решение 0038. Рисует её `compose`: она знает объект и запуск, а слою
 * `ui` мост не положен. Строка только говорит, какой экшон и с какими значениями.
 */
export type RenderRowAction = (action: ActionRef) => ReactNode;

/**
 * Набор `@mapward/display` — решение 0037: ссылки открываются так же, как везде на карте, —
 * куда, говорит ячейка через контекст. Экшоны едут тем же контекстом (0038): кнопку строки и
 * кнопку экшона рисует та же сетка, что и у готовых дисплеев.
 */
export type KitLinks = {
  onOpen: (link: string) => void;
  onOpenTab?: ((link: string) => void) | undefined;
  renderRowAction?: RenderRowAction | undefined;
  renderActionButton?: ((action: ActionRef, label?: string) => ReactNode) | undefined;
  /** Раскрытие дерева по его `id`: запоминает сетка, автору компонента передавать нечего. */
  treeOpen?: ((id: string) => TreeOpen) | undefined;
};

const KitContext = createContext<KitLinks>({ onOpen: () => {} });

export function ProvideKit(props: { links: KitLinks; children: ReactNode }) {
  return <KitContext value={props.links}>{props.children}</KitContext>;
}

export function useKit(): KitLinks {
  return useContext(KitContext);
}
