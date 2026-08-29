import { useState } from "react";
import { isAddress } from "../pure-model/address.ts";
import { findObject, trail } from "../pure-model/model.ts";
import { useMap, useMapActions } from "../adapters/use-map.ts";
import { MetricGrid } from "../_metrics/compose/metric-grid.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { FileList } from "../ui/file-list.tsx";
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
      <Breadcrumbs trail={path} onGo={setAddress} />

      <ObjectHeader
        name={current.name}
        prototypeName={current.prototypeName}
        actions={
          <HeaderButton title="Открыть _index.json" onClick={() => actions.open(current.path)}>
            ⋯
          </HeaderButton>
        }
      />

      <MetricGrid mapRef={props.mapConfig} object={current} onOpen={open} />

      <FileList title="Директивы" files={current.directives} onOpen={actions.open} />
      <FileList title="Экшоны" files={current.actions} onOpen={actions.open} />

      {current.children.length > 0 && (
        <FileList
          title="Внутри"
          files={current.children.map((child) => ({ name: child.name, path: child.address }))}
          onOpen={setAddress}
        />
      )}
    </div>
  );
}
