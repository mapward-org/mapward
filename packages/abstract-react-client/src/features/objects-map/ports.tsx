import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { EditResult, MapOp, ObjectRef } from "@mapward/core";

/**
 * Что вьюхе карты нужно от соседей: правка карты, куда ведёт узел и карточка объекта. Правку
 * делает сервер (решение 0044), холст только зовёт её — стыкует порт с мостом точка входа.
 */
export type ObjectsMapPort = {
  /** Карта, которой принадлежит вьюха: копия с холста вставляется только в свою карту. */
  mapPath: string;
  /** Пачка операций: применяется по очереди и отменяется целиком. */
  edit(ops: MapOp[]): Promise<EditResult>;
  undo(id: string): Promise<EditResult>;
  redo(id: string): Promise<EditResult>;
  open(link: string): void;
  /** Открыть узел отдельным табом — ctrl + клик (решение 0026); хост без табов — поля нет. */
  openTab?: ((link: string) => void) | undefined;
  /** Полное превью объекта; его рисует фича карточки, стыкует точка входа. */
  Card: ComponentType<{ item: ObjectRef; actions?: ReactNode }>;
};

const ObjectsMapContext = createContext<ObjectsMapPort | undefined>(undefined);

export function ProvideObjectsMap(props: { port: ObjectsMapPort; children: ReactNode }) {
  return <ObjectsMapContext value={props.port}>{props.children}</ObjectsMapContext>;
}

export function useObjectsMapPort(): ObjectsMapPort {
  const port = useContext(ObjectsMapContext);
  if (!port) throw new Error("ProvideObjectsMap is missing above the objects map");
  return port;
}
