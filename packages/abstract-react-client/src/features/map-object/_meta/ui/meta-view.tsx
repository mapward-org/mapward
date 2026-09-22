import type { ReactNode } from "react";
import type { ConfigLayer, MapMetric, MapObject } from "@mapward/core";
import { ListRow, type MenuAction } from "../../../../lib/ui/list-row.tsx";
import { Section } from "../../../../lib/ui/section.tsx";
import { howCollected, layerLabel, originHint, ownerHint, propRows } from "../pure-model/meta.ts";

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
 * Возврат к метрикам — та же кнопка шапки, которой сюда вошли, поэтому «назад» внутри
 * экрана нет.
 *
 * Раздел директив рисует соседний подмодуль целиком, с заголовком и поиском, а сводит их
 * вместе `map-object/compose` — так же, как карту детей в сетке метрик (решение 0015).
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
  /** Раздел «Директивы» целиком: заголовок с поиском живёт вместе со списком. */
  directives: ReactNode;
}) {
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
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-auto pb-6">
      <Section icon={props.icons.index} title="Объект">
        <ListRow
          label={props.object.name}
          hint={originHint(props.object.layers)}
          title={props.object.address}
          {...(objectMenu === undefined ? {} : { menu: objectMenu })}
        />
        <dl className="flex flex-col px-3 pt-1 text-[11px] opacity-70">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 truncate">адрес</dt>
            <dd className="truncate">{props.object.address}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 truncate">на диске</dt>
            <dd className="truncate" title={props.object.path}>
              {props.object.path}
            </dd>
          </div>
          {propRows(props.object.props).map((prop) => (
            <div key={prop.key} className="flex gap-2">
              <dt className="w-28 shrink-0 truncate" title={prop.key}>
                {prop.key}
              </dt>
              <dd className="truncate" title={prop.value}>
                {prop.value}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      {props.object.metrics.length > 0 && (
        <Section icon={props.icons.metrics} title="Метрики">
          {props.object.metrics.map((metric) => {
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
      {props.object.workflow.length > 0 && (
        <Section icon={props.icons.workflow} title="Этапы директив">
          {props.object.workflow.map((stage) => (
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

      {props.directives}

      {props.object.actions.length > 0 && (
        <Section icon={props.icons.actions} title="Экшоны">
          {props.object.actions.map((file) => (
            <ListRow
              key={file.path}
              label={file.name}
              {...(ownerHint(file.owner) === undefined
                ? {}
                : { hint: ownerHint(file.owner) as string })}
              {...(openFile === undefined ? {} : { onSelect: () => openFile(file.path) })}
            />
          ))}
        </Section>
      )}
    </div>
  );
}
