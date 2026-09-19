import { useState } from "react";
import { linkKind } from "@mapward/core";
import { findObject, trail } from "@mapward/core";
import { useMap, useMapActions } from "../adapters/use-map.ts";
import { useTerminals } from "../adapters/use-terminals.ts";
import { useCapabilities } from "../adapters/use-capabilities.ts";
import { TerminalMenu } from "../ui/terminal-menu.tsx";
import { MetricGrid } from "../_metrics/compose/metric-grid.tsx";
import { ChildrenMapView } from "../_children-map/compose/children-map.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { ActionsIcon, DirectivesIcon, IndexIcon } from "../ui/icons.tsx";
import { MenuButton } from "../ui/menu-button.tsx";
import { HeaderButton, ObjectHeader } from "../ui/object-header.tsx";
import { Loading } from "../../../lib/ui/loading.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/** Three states, straight from decision 0002: no copy, a different copy, the same copy. */
const statusHint = { new: "новая", changed: "изменилась", done: "выполнена" };

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
                onShow={() => terminals.open()}
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
                  hint: statusHint[file.status ?? "new"],
                  hintClass: statusColor[file.status ?? "new"],
                  onSelect: can.openFile ? () => actions.open(file.path) : () => undefined,
                  runs: !can.terminals
                    ? undefined
                    : [
                        { label: "проверить", onSelect: () => terminals.run(file.path, "check") },
                        {
                          label: "сухой прогон",
                          onSelect: () => terminals.run(file.path, "dry-run"),
                        },
                        { label: "выполнить", onSelect: () => terminals.run(file.path, "run") },
                      ],
                }))}
              />
            )}
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
