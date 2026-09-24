import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { ObjectRef } from "@mapward/core";
import type { NodePlaces } from "./model/children-map.ts";

/** Что карте детей нужно от соседей: где лежат узлы и куда ведёт узел. */
export type ChildrenMapPort = {
  places: NodePlaces;
  open(link: string): void;
  /** Открыть узел отдельным табом — ctrl + клик (решение 0026); хост без табов — поля нет. */
  openTab?: ((link: string) => void) | undefined;
  /** Узел с `object` — карточка объекта; её рисует фича карточки, стыкует точка входа. */
  Card: ComponentType<{ item: ObjectRef }>;
};

const ChildrenMapContext = createContext<ChildrenMapPort | undefined>(undefined);

export function ProvideChildrenMap(props: { port: ChildrenMapPort; children: ReactNode }) {
  return <ChildrenMapContext value={props.port}>{props.children}</ChildrenMapContext>;
}

export function useChildrenMapPort(): ChildrenMapPort {
  const port = useContext(ChildrenMapContext);
  if (!port) throw new Error("ProvideChildrenMap is missing above the children map");
  return port;
}
