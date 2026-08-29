import { useState } from "react";
import { isAddress } from "../pure-model/address.ts";
import { findObject, trail } from "../pure-model/model.ts";
import { useMap, useMapActions } from "../adapters/use-map.ts";
import { MetricGrid } from "../_metrics/compose/metric-grid.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { ActionsIcon, DirectivesIcon, IndexIcon } from "../ui/icons.tsx";
import { MenuButton } from "../ui/menu-button.tsx";
import { HeaderButton, ObjectHeader } from "../ui/object-header.tsx";
import { Loading } from "@/features/maps/ui/loading.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

export function MapObjectView(props: { mapConfig: Ref }) {
  const map = useMap(props.mapConfig);
  const actions = useMapActions();
  // Where you are belongs to the map you are looking at: switching maps starts over.
  const [address, setAddress] = useState<string>();

  if (!map) return <Loading text="Читаем карту…" />;

  const current = (address && findObject(map, address)) || map;
  const path = trail(map, current.address);

  // A link either points into the map or at a file — decision 0005 keeps them apart.
  const open = (link: string) => {
    if (isAddress(link)) setAddress(link);
    else actions.open(link);
  };

  return (
    <div className="pb-2">
      <Breadcrumbs trail={path.slice(0, -1)} onGo={setAddress} />

      <ObjectHeader
        name={current.name}
        prototypeName={current.prototypeName}
        actions={
          <>
            <MenuButton
              title="Директивы"
              icon={DirectivesIcon}
              items={current.directives.map((file) => ({
                key: file.path,
                label: file.name,
                onSelect: () => actions.open(file.path),
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

      <MetricGrid mapRef={props.mapConfig} object={current} onOpen={open} />
    </div>
  );
}
