import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { MapMetric, MapObject } from "@mapward/core";
import type { ActionHandle, Navigate } from "@mapward/component";
import type { ActionRef } from "../../kernel/action-ref.ts";
import type { ObjectRef } from "../../kernel/object-ref.ts";
import type { Watchable } from "../../lib/store/reactive.ts";
import type { ComponentBuilds } from "./adapters/component-builds.ts";
import type { CallMemory } from "./model/call-memory.ts";
import type { PluginStream } from "./pure-model/plugin-stream.ts";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Что метрикам нужно от экшонов — решение 0038: компонент называет экшон (`useAction`), а
 * находят его, запускают и считают прогоны сами экшоны. Метрики их не импортируют (решение 0042).
 */
export type MetricsActions = Watchable & {
  /** Ресурс объекта, где искать экшон, названный адресом: вид, читающий его, подписан и на него. */
  source(run: string): Watchable | undefined;
  /** Экшон по ключу объекта `object` или по адресу — подпись, идущие прогоны, запуск. */
  handle(object: MapObject, ref: ActionRef): ActionHandle;
};

/** Что метрикам нужно от экрана, прогонов и карты детей. */
export type MetricsPort = {
  ref: Ref;
  /**
   * Сборки компонентов — одни на вид объекта, а не на сетку: переживают смену вкладки и переход
   * между объектами, и вернувшаяся клетка рисуется сразу, а не «собирается».
   */
  builds: ComponentBuilds;
  /** Последние ответы `useQuery` и `useStream` по ключу — тоже одни на вид объекта. */
  calls: CallMemory;
  /**
   * `params` метрики, какими их получает компонент: из конфига, а на странице снимка — с
   * перекрытием у снимаемой метрики (`metricParams`).
   */
  params(object: MapObject, metric: MapMetric): Record<string, unknown>;
  /**
   * Перейти к объекту карты. Куда ведёт ссылка, решает плагин `navigation`; объект — его ответ,
   * а переход знает только экран.
   */
  goTo(address: string): void;
  /** Открыть метрику отдельным табом; хост без табов — поля нет, и иконок тоже (0026). */
  openTab?: (metric: MapMetric) => void;
  /** Открыть табом объект, на который ведёт ссылка внутри метрики. */
  openObjectTab?: (link: string) => void;
  actions: MetricsActions;
  /**
   * Карточку объекта — `ObjectCard` набора — рисует её фича. Внутри карточки снова сетка метрик:
   * круг замыкается в точке входа, а не здесь.
   */
  Card: CardView;
};

/** Карточка объекта; холст плагина ставит её `ObjectCard` с кнопками и ручкой. */
export type CardView = ComponentType<{
  item: ObjectRef;
  actions?: ReactNode;
  draggable?: boolean;
}>;

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
 * Что набор `@mapward/component` берёт у ячейки, где нарисован компонент: объект, у которого
 * `useAction` ищет экшон по ключу. У своей формы экшона объекта нет — и `useAction` в ней нет.
 */
export type KitLinks = { object?: MapObject | undefined };

const KitContext = createContext<KitLinks>({});

export function ProvideKit(props: { links: KitLinks; children: ReactNode }) {
  return <KitContext value={props.links}>{props.children}</KitContext>;
}

export function useKit(): KitLinks {
  return useContext(KitContext);
}

/**
 * Плагины для компонента метрики: вызов метода через платформу и путь плагина от файла
 * компонента. Даёт его ячейка метрики-компонента, берут хуки набора.
 */
export type PluginKit = {
  call(plugin: string, method: string, args: unknown): PluginStream;
  resolve(path: string): string;
};

const PluginKitContext = createContext<PluginKit | undefined>(undefined);

export function ProvidePluginKit(props: { kit: PluginKit; children: ReactNode }) {
  return <PluginKitContext value={props.kit}>{props.children}</PluginKitContext>;
}

export function usePluginKit(): PluginKit {
  const kit = useContext(PluginKitContext);
  if (!kit)
    throw new Error("usePlugin работает только в метрике-компоненте: у дисплея плагинов нет");
  return kit;
}

/**
 * Навигация набора — `useNavigation` из `@mapward/component`: ссылку разбирает плагин `navigation`,
 * к объекту переходит экран. `tabs` — умеет ли хост табы: без них ctrl + клик — обычный переход.
 */
export type NavigationPort = { open: Navigate; tabs: boolean };

const NavigationContext = createContext<NavigationPort | undefined>(undefined);

export function ProvideNavigation(props: { navigation: NavigationPort; children: ReactNode }) {
  return <NavigationContext value={props.navigation}>{props.children}</NavigationContext>;
}

/** Навигации нет — компонент нарисован вне сетки метрик (так бывает в тестах). */
export function useNavigationPort(): NavigationPort | undefined {
  return useContext(NavigationContext);
}
