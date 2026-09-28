import { createContext, useContext, type ReactNode } from "react";
import type { MapViews } from "./adapters/map-views.ts";
import type { MapView } from "./model/map-view.ts";

type Views = MapViews<MapView>;

const MapViewsContext = createContext<Views | undefined>(undefined);

/** Живые карты одни на клиент: их заводит точка входа и раздаёт всем экранам. */
export function ProvideMapViews(props: { views: Views; children: ReactNode }) {
  return <MapViewsContext value={props.views}>{props.children}</MapViewsContext>;
}

export function useMapViews(): Views {
  const views = useContext(MapViewsContext);
  if (!views) throw new Error("ProvideMapViews is missing above this component");
  return views;
}
