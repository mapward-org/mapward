import { action, computed, makeObservable, observableRef } from "mobx";
import { groupLayout, groupMetrics, linkKind, pickGroup } from "@mapward/core";
import type { Capabilities, Layout, MapMetric, MapObject, MetricGroup } from "@mapward/core";
import { keyClashes } from "../../../kernel/clashes.ts";
import { crumbsOf, type Crumb } from "../pure-model/breadcrumbs.ts";
import {
  amend,
  currentScreen,
  startHistory,
  stepTarget,
  stepTo,
  visit,
  type History,
  type Screen,
} from "../pure-model/navigation.ts";

/**
 * Что экрану нужно от карты: объект по адресу, есть ли он, и его предки для крошек. Объект —
 * `MapObject`: живой узел модели им и является, и экран читает у него только свои поля.
 */
export type ScreenMap = {
  object(address: string): MapObject;
  has(address: string): boolean;
  ancestors(address: string): MapObject[];
};

/** Что экрану нужно от хоста: что он умеет и что умеет открыть. */
export type ScreenHost = {
  can: Capabilities;
  open(path: string): void;
  openExternal(url: string): void;
  openInTab(target: {
    mapPath: string;
    basePath: string;
    name: string;
    address: string;
    group?: string;
    metric?: string;
  }): void;
};

/** Три вида одного объекта: что показывают метрики, как он устроен и что на нём запускали. */
export type ObjectView = "metrics" | "meta" | "runs";

/** Куда ведёт стрелка: объект по ту сторону шага истории. Идти некуда — стрелки нет. */
export type Arrow = { name: string; address: string; go: () => void };

/**
 * С чего вид начинается — решение 0026. В сайдбаре ни с чего: он открывается на корне карты.
 * Таб открывается на том, ради чего его завели: объект, вкладка, а иногда и одна метрика.
 */
export type StartAt = { address?: string; group?: string; metric?: string };

const startScreen = (start: StartAt | undefined): Screen => ({
  address: start?.address ?? "mapward://",
  ...(start?.group === undefined ? {} : { group: start.group }),
  ...(start?.metric === undefined ? {} : { solo: start.metric }),
});

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Экран объекта — где ты и откуда пришёл (решение 0036). Шаг — объект; вкладка, мета-экран,
 * прогоны и метрика во всю ширину уточняют текущий шаг и восстанавливаются вместе с ним. Где
 * история хранится, экран не знает: у таба она едет с тем, на чём он открыт, у сайдбара лежит в
 * состоянии вида — для этого `onHistory`.
 */
export class ScreenStore {
  history: History;

  constructor(
    private readonly map: ScreenMap,
    private readonly host: ScreenHost,
    readonly ref: Ref,
    start: { history?: History | undefined; at?: StartAt | undefined },
    private readonly onHistory?: ((history: History) => void) | undefined,
  ) {
    this.history = start.history ?? startHistory(startScreen(start.at));
    makeObservable<ScreenStore, "screen">(this, {
      history: observableRef,
      update: action,
      screen: computed,
      object: computed,
      openGroup: computed,
      shown: computed,
      layout: computed,
      soloMetric: computed,
      crumbs: computed,
      back: computed,
      forward: computed,
      clashes: computed,
    });
  }

  update(next: History): void {
    this.history = next;
    this.onHistory?.(next);
  }

  private get screen(): Screen {
    return currentScreen(this.history);
  }

  /** Объект на экране; пропавший ведёт к корню. */
  get object(): MapObject {
    return this.map.object(this.screen.address);
  }

  get meta(): boolean {
    return this.screen.meta ?? false;
  }

  /** Экран прогонов — третий режим объекта, как мета-экран (решение 0038). */
  get runsOpen(): boolean {
    return this.screen.runs ?? false;
  }

  get selectedRun(): string | undefined {
    return this.screen.run;
  }

  /** Вид объекта одним полем: мини-вкладки под шапкой переключают из любого в любой. */
  get view(): ObjectView {
    return this.runsOpen ? "runs" : this.meta ? "meta" : "metrics";
  }

  /** Мета-экран и прогоны — режимы объекта; директивы и вкладки — только в обычном виде. */
  get plain(): boolean {
    return !this.meta && !this.runsOpen;
  }

  /** Открытая вкладка — решение 0025: названная, если она есть, иначе первая. */
  get openGroup(): MetricGroup | undefined {
    return pickGroup(this.object, this.screen.group);
  }

  get groupKey(): string | undefined {
    return this.openGroup?.key;
  }

  /** Описание открытой вкладки — разметкой над сеткой (решение 0025). */
  get groupDescription(): string | undefined {
    return this.hasGroups ? this.openGroup?.description : undefined;
  }

  /**
   * Ключи, занятые и метрикой, и экшоном, — ошибка объекта (решение 0038): раскладка находит
   * клетку по ключу, и такой ключ назвал бы две вещи сразу.
   */
  get clashes(): string[] {
    return keyClashes(this.object.metrics, this.object.actions);
  }

  /** Что умеет хост: без этого кнопок терминалов и директив нет вовсе (решение 0014). */
  get can(): Capabilities {
    return this.host.can;
  }

  /** Есть ли у объекта экшоны: нет — нет и кнопки меню экшонов в шапке. */
  get hasActions(): boolean {
    return this.object.actions.length > 0;
  }

  get hasGroups(): boolean {
    return this.plain && this.object.metricGroups.length > 0;
  }

  /** Метрики открытой вкладки. */
  get shown(): MapMetric[] {
    return groupMetrics(this.object, this.screen.group);
  }

  get layout(): Layout | undefined {
    return groupLayout(this.object, this.openGroup);
  }

  /**
   * Метрика таба ищется среди всех метрик объекта, а не только в открытой вкладке: таб могли
   * открыть на метрику, чью вкладку никто не называл, и пустой экран был бы враньём.
   */
  get soloMetric(): MapMetric | undefined {
    const solo = this.screen.solo;
    return solo ? this.object.metrics.find((metric) => metric.key === solo) : undefined;
  }

  get soloLabel(): string {
    const metric = this.soloMetric;
    return metric ? (metric.config.label ?? metric.key) : "";
  }

  /** Крошки: предки-объекты, от корня и без самого объекта (решение 0036). */
  get crumbs(): Crumb[] {
    return crumbsOf(this.map.ancestors(this.object.address));
  }

  /** Стрелки — назад и вперёд по истории, к родителю ведут крошки (0036). */
  get back(): Arrow | undefined {
    return this.arrow(-1);
  }

  get forward(): Arrow | undefined {
    return this.arrow(1);
  }

  private arrow(direction: -1 | 1): Arrow | undefined {
    const index = stepTarget(this.history, direction, (address) => this.map.has(address));
    if (index === undefined) return undefined;
    const target = currentScreen(stepTo(this.history, index)).address;
    return {
      name: this.map.object(target).name,
      address: target,
      go: () => this.update(stepTo(this.history, index)),
    };
  }

  /** Новый шаг — обычный вид объекта: метрика во весь экран была метрикой прежнего. */
  go(address: string): void {
    this.update(visit(this.history, address));
  }

  setView(next: ObjectView): void {
    this.update(
      amend(this.history, { meta: next === "meta", runs: next === "runs", run: undefined }),
    );
  }

  setGroup(key: string): void {
    this.update(amend(this.history, { group: key }));
  }

  /** Вернуться из таба метрики к объекту целиком. */
  showObject(): void {
    this.update(amend(this.history, { solo: undefined }));
  }

  /** Экран прогонов с выбранным прогоном; выбранный едет в истории вместе с ним (0038). */
  openRuns(run?: string): void {
    this.update(amend(this.history, { meta: false, runs: true, run }));
  }

  /**
   * Ссылка ведёт туда, куда обещает схема — решение 0005: `mapward://` в объект, всё прочее
   * со схемой наружу, остальное файлом в редактор. Если хост файлы открывать не умеет, ссылка
   * просто ничего не делает (решение 0014).
   */
  open(link: string): void {
    const kind = linkKind(link);
    if (kind === "object") this.go(link);
    else if (kind === "external") this.host.openExternal(link);
    else if (this.host.can.openFile) this.host.open(link);
  }

  /** Умеет ли хост табы — решение 0026. Не умеет — иконок и жестов «в табе» нет вовсе. */
  get tabs(): boolean {
    return this.host.can.tabs;
  }

  /** Ctrl + клик по стрелке или крошке — объект отдельным табом; хост без табов жеста не даёт. */
  get objectTab(): ((address: string) => void) | undefined {
    return this.tabs ? (address) => this.openObjectTab(address) : undefined;
  }

  /**
   * Тот же объект отдельным табом — решение 0026: ctrl + клик по ссылке, вкладке, метрике.
   * Не названный объект — текущий.
   */
  openTab(what: {
    address?: string | undefined;
    group?: string | undefined;
    metric?: string | undefined;
  }): void {
    if (!this.host.can.tabs) return;
    this.host.openInTab({
      ...this.ref,
      address: what.address ?? this.object.address,
      ...(what.group === undefined ? {} : { group: what.group }),
      ...(what.metric === undefined ? {} : { metric: what.metric }),
    });
  }

  /** Объект по ссылке — отдельным табом, где бы ссылка ни стояла (0026, 0035). */
  openObjectTab(link: string): void {
    this.openTab({ address: link });
  }

  /** Открытая вкладка — отдельным табом. */
  openGroupTab(key?: string): void {
    this.openTab({ group: key ?? this.groupKey });
  }

  /** Метрика открытой вкладки — отдельным табом, во всю ширину (решение 0026). */
  openMetricTab(metric: MapMetric): void {
    this.openTab({ group: this.groupKey, metric: metric.key });
  }
}
