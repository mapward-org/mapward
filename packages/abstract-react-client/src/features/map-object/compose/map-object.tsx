import { useState } from "react";
import { linkKind } from "@mapward/core";
import { findObject, objectIndex, trail } from "@mapward/core";
import type { ConfigLayer, MapFile, MapMetric, MapObject } from "@mapward/core";
import { useMap, useMapActions } from "../adapters/use-map.ts";
import { useTerminals } from "../adapters/use-terminals.ts";
import { useCapabilities } from "../adapters/use-capabilities.ts";
import { TerminalMenu } from "../ui/terminal-menu.tsx";
import { MetricGrid } from "../_metrics/compose/metric-grid.tsx";
import { ChildrenMapView } from "../_children-map/compose/children-map.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { ActionsIcon, DirectivesIcon, IndexIcon, MetricsIcon, WorkflowIcon } from "../ui/icons.tsx";
import { MenuButton } from "../ui/menu-button.tsx";
import { HeaderButton, ObjectHeader } from "../ui/object-header.tsx";
import { Loading } from "../../../lib/ui/loading.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/** Three states, straight from decision 0002: no copy, a different copy, the same copy. */
const statusHint = { new: "новая", changed: "изменилась", done: "выполнена" };

/**
 * Какой этап на директиве шёл последним: отметку ставит сам прогон, а не интерфейс
 * (решение 0017).
 */
const runHint = (file: MapFile): string | undefined =>
  file.run === undefined
    ? undefined
    : file.run.finishedAt === undefined
      ? `${file.run.stage}…`
      : file.run.stage.toLowerCase();

/**
 * Откуда конфиг — одним словом. Своё молчит: подсказка стоит в той же строке, что название,
 * и забирает ширину у него первой. Какой именно прототип и какая общая — написано на кнопках
 * слоёв под пунктом, там место есть (решение 0019).
 */
function originHint(layers: ConfigLayer[]): string | undefined {
  if (layers.some((layer) => layer.from === "prototype")) return "из прототипа";
  return layers.some((layer) => layer.from === "extends") ? "из общей" : undefined;
}

/** Адрес слоя метрики ведёт в её папку, а файл написал объект — он двумя сегментами выше. */
const layerOwner = (address: string) => address.replace(/\/_metrics\/[^/]+$/, "");

/** Подпись кнопки слоя: чей это файл. Своё так и зовётся, чужое — именем объекта или адресом. */
function layerLabel(map: MapObject, layer: ConfigLayer): string {
  if (layer.from === "own") return "свой";
  const where = layerOwner(layer.address);
  if (layer.from === "prototype") return findObject(map, where)?.name ?? where;
  return where.replace("mapward://", "");
}

/** Кнопки слоёв под пунктом: мердж читают, а правят файлы, из которых он собран. */
const layerRuns = (map: MapObject, layers: ConfigLayer[], open: (path: string) => void) =>
  layers.map((layer) => ({
    key: layer.path,
    label: layerLabel(map, layer),
    onSelect: () => open(layer.path),
  }));

/** Вид коллектора схемой не сужен — он просто строка (решение 0004), поэтому берём её осторожно. */
const kinds = (list?: Record<string, unknown>[]) =>
  [...new Set((list ?? []).map((one) => one["kind"]))].filter(
    (kind): kind is string => typeof kind === "string",
  );

/** Чем метрика собирается — одной строкой: за этим конфиг и открывают. */
function howCollected(metric: MapMetric): string {
  return [
    metric.config.refresh ?? "manual",
    ...kinds(metric.config.collectors),
    ...kinds(metric.config.transforms),
    metric.config.display?.kind ?? "без дисплея",
  ].join(" · ");
}

const statusColor = {
  new: "text-[var(--mw-charts-blue,#4a9)]",
  changed: "text-[var(--mw-charts-yellow,#c93)]",
  done: "text-[var(--mw-charts-green,#3a3)]",
};

export function MapObjectView(props: { mapConfig: Ref }) {
  const map = useMap(props.mapConfig);
  const actions = useMapActions();
  // Where you are belongs to the map you are looking at: switching maps starts over.
  const [address, setAddress] = useState<string>();
  const terminals = useTerminals(props.mapConfig, address ?? "mapward://");
  // Клиент рисует только то, что хост обещал уметь — решение 0014.
  const can = useCapabilities();

  if (!map) return <Loading text="Читаем карту…" />;

  const current = (address && findObject(map, address)) || map;
  const path = trail(map, current.address);

  /**
   * Ссылка ведёт туда, куда обещает схема — решение 0005: `mapward://` в объект, всё прочее
   * со схемой наружу, остальное файлом в редактор. Если хост файлы открывать не умеет, ссылка
   * просто ничего не делает (решение 0014).
   */
  const open = (link: string) => {
    const kind = linkKind(link);
    if (kind === "object") setAddress(link);
    else if (kind === "external") actions.openExternal(link);
    else if (can.openFile) actions.open(link);
  };

  return (
    <div className="flex h-full flex-col pb-2">
      <Breadcrumbs trail={path.slice(0, -1)} onGo={setAddress} />

      <ObjectHeader
        name={current.name}
        prototypeName={current.prototypeName}
        actions={
          <>
            {can.terminals && (
              <TerminalMenu
                terminals={terminals.terminals}
                onOpen={() => terminals.open()}
                onFresh={() => terminals.open(true)}
                onShow={terminals.show}
                onClose={terminals.close}
              />
            )}
            {(can.openFile || can.terminals) && (
              <MenuButton
                title="Директивы"
                icon={DirectivesIcon}
                lead={
                  can.ask
                    ? {
                        label: "новая директива",
                        onSelect: () => actions.createDirective(current.path),
                      }
                    : undefined
                }
                items={current.directives.toReversed().map((file) => ({
                  key: file.path,
                  label: file.name,
                  hint: runHint(file) ?? statusHint[file.status ?? "new"],
                  hintClass: statusColor[file.status ?? "new"],
                  onSelect: can.openFile ? () => actions.open(file.path) : () => undefined,
                  // Кнопка не запускает этап, а просит агента его запустить: в живую сессию
                  // уходит фраза, промпт агент берёт из MCP сам — решение 0017. Этапы те же,
                  // что действуют на объекте, поэтому новый файл этапа даёт новую кнопку.
                  runs: can.terminals
                    ? current.workflow.map((stage) => ({
                        // Многоточие значит «идёт сейчас», поэтому смотрим не на последний
                        // прогон, а на незакрытый: закончившийся этап помечать нечем.
                        label:
                          file.run?.stage === stage.name && file.run.finishedAt === undefined
                            ? `${stage.name}…`
                            : stage.name,
                        onSelect: () => terminals.runStage(file.name, stage.name),
                      }))
                    : undefined,
                  // Крестик — только у своей директивы: унаследованная лежит в папке прототипа,
                  // и убирают её там. Спросить «точно?» умеет хост, поэтому без `ask` его нет:
                  // удаление — единственное необратимое, что делает этот экран (решение 0014).
                  onRemove:
                    can.ask && file.owner === undefined
                      ? () => actions.deleteDirective(current.path, file.name)
                      : undefined,
                }))}
              />
            )}
            <MenuButton
              title="Этапы директив"
              icon={WorkflowIcon}
              items={current.workflow.map((stage) => ({
                key: stage.name,
                label: stage.name,
                // Откуда этап взялся: свой, от прототипа или дефолт инструмента. Иначе по
                // экрану не отличить настроенный воркфлоу от встроенного (решение 0017).
                hint: stage.path === "" ? "по умолчанию" : (stage.owner ?? "свой"),
                hintClass: stage.marksDone ? statusColor.done : undefined,
                onSelect:
                  can.openFile && stage.path !== ""
                    ? () => actions.open(stage.path)
                    : () => undefined,
              }))}
            />
            {can.openFile && (
              <MenuButton
                title="Экшоны"
                icon={ActionsIcon}
                items={current.actions.map((file) => ({
                  key: file.path,
                  label: file.name,
                  onSelect: () => actions.open(file.path),
                }))}
              />
            )}
            {/*
              Конфигурация — такие же данные объекта, как остальные, и смотрится она отсюда,
              а не второй панелью (решение 0019). Хост, не умеющий показать текст без файла,
              меню не показывает: рисовать пункт, за которым ничего не произойдёт, нельзя
              (решение 0014).
            */}
            {can.virtualDocs && (
              <MenuButton
                title="Метрики"
                icon={MetricsIcon}
                items={current.metrics.map((metric) => ({
                  key: metric.key,
                  label: metric.config.label ?? metric.key,
                  title: howCollected(metric),
                  hint: originHint(metric.layers),
                  // Мерджа нет файлом: его собирает карта из нескольких, и показывается он
                  // документом, которого на диске не существует.
                  onSelect: () =>
                    actions.openVirtual(
                      `${current.name}/${metric.key}.json`,
                      JSON.stringify(metric.config, null, 2),
                      "json",
                    ),
                  ...(can.openFile ? { runs: layerRuns(map, metric.layers, actions.open) } : {}),
                }))}
              />
            )}
            {/*
              У объекта та же болезнь, что у метрики: в `_index.json` наследника часто одна
              строка `extends`, а смысл у прототипа. Поэтому и форма та же — пункт открывает
              мердж, кнопки под ним открывают слои (решение 0019). Группе показывать нечего:
              `_index.json` у неё нет, поэтому нет и слоёв.
            */}
            {current.layers.length > 0 &&
              (can.virtualDocs ? (
                <MenuButton
                  title="Конфигурация объекта"
                  icon={IndexIcon}
                  items={[
                    {
                      key: current.address,
                      label: current.name,
                      hint: originHint(current.layers),
                      onSelect: () =>
                        actions.openVirtual(
                          `${current.name}/_index.json`,
                          JSON.stringify(objectIndex(current), null, 2),
                          "json",
                        ),
                      ...(can.openFile
                        ? { runs: layerRuns(map, current.layers, actions.open) }
                        : {}),
                    },
                  ]}
                />
              ) : (
                can.openFile && (
                  <HeaderButton
                    title="Открыть _index.json"
                    onClick={() => actions.open(`${current.path}/_index.json`)}
                  >
                    {IndexIcon}
                  </HeaderButton>
                )
              ))}
          </>
        }
      />

      <div className="min-h-0 flex-1">
        <MetricGrid
          mapRef={props.mapConfig}
          object={current}
          onOpen={open}
          renderMap={(childrenMap, metricAddress) => (
            <ChildrenMapView
              map={childrenMap}
              mapPath={props.mapConfig.mapPath}
              address={metricAddress}
              onOpen={open}
            />
          )}
        />
      </div>
    </div>
  );
}
