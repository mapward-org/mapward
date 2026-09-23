import type { ReactNode } from "react";
import type { ConfigLayer, MapFile, MapMetric, MapObject } from "@mapward/core";
import { ListRow, type MenuAction } from "../../../../lib/ui/list-row.tsx";
import { Section } from "../../../../lib/ui/section.tsx";
import {
  howCollected,
  layerLabel,
  originHint,
  ownerHint,
  type MetaFound,
} from "../pure-model/meta.ts";

export type MetaIcons = {
  index: ReactNode;
  metrics: ReactNode;
  workflow: ReactNode;
  actions: ReactNode;
};

/**
 * Второй режим объекта: всё, что объект о себе знает, — вместо ряда меню в шапке
 * (решение 0024). Показывает и то, чего хост открыть не умеет: имена, происхождение
 * и `props` — это текст, а не действие, и `0014` их не запрещает.
 *
 * Разделы сворачиваются, а действия строки лежат в меню на кнопке «слои» — решение 0028.
 * Возврат к метрикам — мини-вкладка вида под шапкой, поэтому «назад» внутри экрана нет.
 *
 * Поиск один на весь экран: поле стоит над разделами и не уезжает при прокрутке, а каждый
 * раздел показывает только совпавшие строки. Раздел без совпадений не рисуется, чтобы
 * найденное не терялось между пустыми заголовками; не совпало нигде — одна строка об этом.
 * Что совпало, считает `searchMeta`, а вид только рисует отобранное.
 *
 * Раздел директив рисует соседний подмодуль целиком, а сводит их вместе `map-object/compose` —
 * так же, как карту детей в сетке метрик (решение 0015). Вид отдаёт ему уже отобранный список.
 */
export function MetaView(props: {
  map: MapObject;
  object: MapObject;
  icons: MetaIcons;
  /** Мердж конфига — документ, которого на диске нет; хост без такого умения его не получает. */
  onOpenObjectConfig?: () => void;
  onOpenMetricConfig?: (metric: MapMetric) => void;
  /** Файл слоя — единственное, что можно править. */
  onOpenFile?: (path: string) => void;
  /** Набранный запрос — поле откликается сразу, а `found` может догонять его позже. */
  query: string;
  onQuery: (query: string) => void;
  found: MetaFound;
  /** Раздел «Директивы» целиком, по отобранному списку. */
  directives: (files: MapFile[]) => ReactNode;
}) {
  const found = props.found;
  const searching = props.query.trim() !== "";
  const openFile = props.onOpenFile;
  const openObjectConfig = props.onOpenObjectConfig;
  const openMetricConfig = props.onOpenMetricConfig;

  /**
   * Меню строки: мердж читают, а правят файлы, из которых он собран. Мердж называется
   * «собранным видом», а не «открыть»: открывают файл, а его на диске нет (решение 0028).
   */
  const menu = (merged: (() => void) | undefined, list: ConfigLayer[]) => {
    const actions: MenuAction[] = [
      ...(merged === undefined
        ? []
        : [{ key: "merged", label: "собранный вид", onSelect: merged }]),
      ...(openFile === undefined
        ? []
        : list.map((layer) => ({
            key: layer.path,
            label: layerLabel(props.map, layer),
            onSelect: () => openFile(layer.path),
          }))),
    ];
    return actions.length === 0 ? undefined : { label: "слои", actions };
  };

  const objectMenu = menu(openObjectConfig, props.object.layers);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        type="search"
        value={props.query}
        placeholder="поиск по объекту"
        onChange={(event) => props.onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onQuery("");
        }}
        className="mx-3 my-1 shrink-0 rounded-sm border border-[var(--mw-input-border,#8884)] bg-[var(--mw-input-background,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--mw-input-foreground,inherit)] outline-none focus:border-[var(--mw-focusBorder,#48f)]"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto pb-6">
        {found.nothing && <p className="px-3 py-0.5 text-[11px] opacity-50">не нашлось</p>}

        {found.object && (
          <Section icon={props.icons.index} title="Объект">
            <ListRow
              label={props.object.name}
              hint={originHint(props.object.layers)}
              title={props.object.address}
              {...(objectMenu === undefined ? {} : { menu: objectMenu })}
            />
            {found.fields.length > 0 && (
              <dl className="flex flex-col px-3 pt-1 text-[11px] opacity-70">
                {found.fields.map((row) => (
                  <div key={row.key} className="flex gap-2">
                    <dt className="w-28 shrink-0 truncate" title={row.key}>
                      {row.key}
                    </dt>
                    <dd className="truncate" title={row.value}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>
        )}

        {found.metrics.length > 0 && (
          <Section icon={props.icons.metrics} title="Метрики">
            {found.metrics.map((metric) => {
              const metricMenu = menu(
                openMetricConfig === undefined ? undefined : () => openMetricConfig(metric),
                metric.layers,
              );
              return (
                <ListRow
                  key={metric.key}
                  label={metric.config.label ?? metric.key}
                  title={howCollected(metric)}
                  hint={originHint(metric.layers)}
                  {...(metricMenu === undefined ? {} : { menu: metricMenu })}
                />
              );
            })}
          </Section>
        )}

        {/*
        Этапы стоят перед директивами: по ним читают, что у директивы вообще можно запустить,
        а архив — это то, куда заглядывают реже.
      */}
        {found.workflow.length > 0 && (
          <Section icon={props.icons.workflow} title="Этапы директив">
            {found.workflow.map((stage) => (
              <ListRow
                key={stage.name}
                label={stage.name}
                // Откуда этап взялся: свой, от прототипа или дефолт инструмента. Иначе по экрану
                // не отличить настроенный воркфлоу от встроенного (решение 0017).
                hint={stage.path === "" ? "по умолчанию" : (ownerHint(stage.owner) ?? "свой")}
                {...(stage.marksDone ? { hintClass: "text-[var(--mw-charts-green,#3a3)]" } : {})}
                {...(openFile === undefined || stage.path === ""
                  ? {}
                  : { onSelect: () => openFile(stage.path) })}
              />
            ))}
          </Section>
        )}

        {/* Экшоны — над директивами: их запускают и правят чаще, чем листают архив директив. */}
        {found.actions.length > 0 && (
          <Section icon={props.icons.actions} title="Экшоны">
            {/* На мета-экране экшон — это его конфиг: открыть и поправить, а не запустить. */}
            {found.actions.map((action) => (
              <ListRow
                key={action.address}
                label={action.config.label ?? action.key}
                {...(ownerHint(action.owner) === undefined
                  ? {}
                  : { hint: ownerHint(action.owner) as string })}
                {...(openFile === undefined ? {} : { onSelect: () => openFile(action.configPath) })}
              />
            ))}
          </Section>
        )}

        {(!searching || found.directives.length > 0) && props.directives(found.directives)}
      </div>
    </div>
  );
}
