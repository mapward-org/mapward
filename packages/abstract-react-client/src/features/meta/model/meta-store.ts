import { objectIndex } from "@mapward/core";
import type { ConfigLayer, MapAction, MapMetric, MapObject, MapStage } from "@mapward/core";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";
import { layerLabel, prototypeOwners, searchMeta, type MetaFound } from "../pure-model/meta.ts";

/**
 * Что мета-экрану нужно от хоста и карты. Объект по адресу приходит с сервера: пока не пришёл —
 * `undefined`, а ждут его подпиской на `feed`.
 */
export type MetaHost = {
  can: { openFile: boolean; virtualDocs: boolean };
  open(path: string): void;
  openVirtual(title: string, text: string, language: string): void;
  object(address: string): MapObject | undefined;
  feed(address: string): Watchable;
};

/** Меню строки — кнопка «слои» и пункты под ней (решение 0028). */
export type LayersMenu = {
  label: string;
  actions: { key: string; label: string; onSelect: () => void }[];
};

/**
 * Мета-экран объекта — решение 0024: всё, что объект о себе знает. Что хост умеет, решается
 * здесь — клиент не рисует того, чего ему не обещали (решение 0014). Запрос поиска никуда не
 * сохраняется, а на другом объекте экран пересоздаётся, и поле начинается пустым.
 *
 * Подписи слоёв называют прототипы по имени — их объекты стор ждёт: пока не пришли, на кнопке
 * адрес.
 */
export class MetaStore extends Reactive {
  private readonly typed = this.state("");

  constructor(
    private readonly object: () => MapObject,
    private readonly host: MetaHost,
  ) {
    super();
    this.depend(...prototypeOwners(object()).map((address) => host.feed(address)));
  }

  get query(): string {
    return this.typed.value;
  }

  setQuery(query: string): void {
    this.typed.set(query);
  }

  get found(): MetaFound {
    return searchMeta(this.object(), this.query);
  }

  /** Раздел директив рисуется без запроса всегда, а с запросом — если в нём что-то совпало. */
  get showDirectives(): boolean {
    return this.query.trim() === "" || this.found.directives.length > 0;
  }

  get objectMenu(): LayersMenu | undefined {
    return this.menu(
      this.canOpenMerged ? () => this.openObjectConfig() : undefined,
      this.object().layers,
    );
  }

  metricMenu(metric: MapMetric): LayersMenu | undefined {
    return this.menu(
      this.canOpenMerged ? () => this.openMetricConfig(metric) : undefined,
      metric.layers,
    );
  }

  /** Этап по умолчанию файла не имеет — открывать нечего. */
  stageOpen(stage: MapStage): (() => void) | undefined {
    return this.canOpenFile && stage.path !== "" ? () => this.openFile(stage.path) : undefined;
  }

  /** На мета-экране экшон — это его конфиг: открыть и поправить, а не запустить. */
  actionOpen(one: MapAction): (() => void) | undefined {
    return this.canOpenFile ? () => this.openFile(one.configPath) : undefined;
  }

  /**
   * Меню строки: мердж читают, а правят файлы, из которых он собран. Мердж называется
   * «собранным видом», а не «открыть»: открывают файл, а его на диске нет (решение 0028).
   */
  private menu(merged: (() => void) | undefined, list: ConfigLayer[]): LayersMenu | undefined {
    const actions = [
      ...(merged === undefined
        ? []
        : [{ key: "merged", label: "собранный вид", onSelect: merged }]),
      ...(this.canOpenFile
        ? list.map((layer) => ({
            key: layer.path,
            label: this.layerName(layer),
            onSelect: () => this.openFile(layer.path),
          }))
        : []),
    ];
    return actions.length === 0 ? undefined : { label: "слои", actions };
  }

  layerName(layer: ConfigLayer): string {
    return layerLabel((address) => this.host.object(address), layer);
  }

  get canOpenFile(): boolean {
    return this.host.can.openFile;
  }

  /**
   * Мерджа нет файлом: его собирает карта из нескольких, и показывается он документом, которого
   * на диске не существует (решение 0019). Хост без таких документов этой кнопки не получает.
   */
  get canOpenMerged(): boolean {
    return this.host.can.virtualDocs;
  }

  openFile(path: string): void {
    this.host.open(path);
  }

  openObjectConfig(): void {
    const object = this.object();
    this.host.openVirtual(
      `${object.name}/_index.json`,
      JSON.stringify(objectIndex(object), null, 2),
      "json",
    );
  }

  openMetricConfig(metric: MapMetric): void {
    this.host.openVirtual(
      `${this.object().name}/${metric.key}.json`,
      JSON.stringify(metric.config, null, 2),
      "json",
    );
  }
}
