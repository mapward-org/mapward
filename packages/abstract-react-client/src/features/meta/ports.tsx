import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { MapFile, MapObject } from "@mapward/core";
import type { MetaHost } from "./model/meta-store.ts";

/**
 * Что мета-экрану нужно от соседей — решение 0042: хост и карта, чтобы открыть файл и назвать
 * слой, и раздел директив, который рисует их фича по уже отобранному списку.
 */
export type MetaPort = MetaHost & {
  Directives: ComponentType<{ object: MapObject; files: MapFile[] }>;
};

const MetaContext = createContext<MetaPort | undefined>(undefined);

export function ProvideMeta(props: { port: MetaPort; children: ReactNode }) {
  return <MetaContext value={props.port}>{props.children}</MetaContext>;
}

export function useMetaPort(): MetaPort {
  const port = useContext(MetaContext);
  if (!port) throw new Error("ProvideMeta is missing above the meta screen");
  return port;
}
