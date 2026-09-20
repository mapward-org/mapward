import { useState } from "react";
import { linkKind } from "@mapward/core";
import { findObject, trail } from "@mapward/core";
import type { MapFile } from "@mapward/core";
import { useMap, useMapActions } from "../adapters/use-map.ts";
import { useTerminals } from "../adapters/use-terminals.ts";
import { useCapabilities } from "../adapters/use-capabilities.ts";
import { TerminalMenu } from "../ui/terminal-menu.tsx";
import { MetricGrid } from "../_metrics/compose/metric-grid.tsx";
import { ChildrenMapView } from "../_children-map/compose/children-map.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { ActionsIcon, DirectivesIcon, IndexIcon, WorkflowIcon } from "../ui/icons.tsx";
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
            {can.openFile && (
              <HeaderButton
                title="Открыть _index.json"
                onClick={() => actions.open(`${current.path}/_index.json`)}
              >
                {IndexIcon}
              </HeaderButton>
            )}
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
