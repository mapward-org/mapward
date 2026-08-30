import { useState } from "react";
import { isAddress } from "../pure-model/address.ts";
import { findObject, trail } from "../pure-model/model.ts";
import { useMap, useMapActions } from "../adapters/use-map.ts";
import { useTerminals } from "../adapters/use-terminals.ts";
import { TerminalMenu } from "../ui/terminal-menu.tsx";
import { MetricGrid } from "../_metrics/compose/metric-grid.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { ActionsIcon, DirectivesIcon, IndexIcon } from "../ui/icons.tsx";
import { MenuButton } from "../ui/menu-button.tsx";
import { HeaderButton, ObjectHeader } from "../ui/object-header.tsx";
import { Loading } from "@/features/maps/ui/loading.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/** Three states, straight from decision 0002: no copy, a different copy, the same copy. */
const statusHint = { new: "новая", changed: "изменилась", done: "выполнена" };

const statusColor = {
  new: "text-[var(--vscode-charts-blue,#4a9)]",
  changed: "text-[var(--vscode-charts-yellow,#c93)]",
  done: "text-[var(--vscode-charts-green,#3a3)]",
};

export function MapObjectView(props: { mapConfig: Ref }) {
  const map = useMap(props.mapConfig);
  const actions = useMapActions();
  // Where you are belongs to the map you are looking at: switching maps starts over.
  const [address, setAddress] = useState<string>();
  const terminals = useTerminals(props.mapConfig, address ?? "mapward://");

  if (!map) return <Loading text="Читаем карту…" />;

  const current = (address && findObject(map, address)) || map;
  const path = trail(map, current.address);

  // A link either points into the map or at a file — decision 0005 keeps them apart.
  const open = (link: string) => {
    if (isAddress(link)) setAddress(link);
    else actions.open(link);
  };

  return (
    <div className="flex h-full flex-col pb-2">
      <Breadcrumbs trail={path.slice(0, -1)} onGo={setAddress} />

      <ObjectHeader
        name={current.name}
        prototypeName={current.prototypeName}
        actions={
          <>
            <TerminalMenu
              terminals={terminals.terminals}
              onOpen={() => terminals.open()}
              onFresh={() => terminals.open(true)}
              onShow={() => terminals.open()}
              onClose={terminals.close}
            />
            <MenuButton
              title="Директивы"
              icon={DirectivesIcon}
              lead={{
                label: "новая директива",
                onSelect: () => actions.createDirective(current.path),
              }}
              items={current.directives.toReversed().map((file) => ({
                key: file.path,
                label: file.name,
                hint: statusHint[file.status ?? "new"],
                hintClass: statusColor[file.status ?? "new"],
                onSelect: () => actions.open(file.path),
                runs: [
                  { label: "проверить", onSelect: () => terminals.run(file.path, "check") },
                  { label: "сухой прогон", onSelect: () => terminals.run(file.path, "dry-run") },
                  { label: "выполнить", onSelect: () => terminals.run(file.path, "run") },
                ],
              }))}
            />
            <MenuButton
              title="Экшоны"
              icon={ActionsIcon}
              items={current.actions.map((file) => ({
                key: file.path,
                label: file.name,
                onSelect: () => actions.open(file.path),
              }))}
            />
            <HeaderButton
              title="Открыть _index.json"
              onClick={() => actions.open(`${current.path}/_index.json`)}
            >
              {IndexIcon}
            </HeaderButton>
          </>
        }
      />

      <div className="min-h-0 flex-1">
        <MetricGrid mapRef={props.mapConfig} object={current} onOpen={open} />
      </div>
    </div>
  );
}
