import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { Layout, MapMetric, MapObject } from "@mapward/core";

/**
 * Что карточке объекта нужно от соседей — решение 0042. Сама карточка умеет немного: найти
 * объект, выбрать вкладку и уложиться в размер. Всё внутри рисуют фичи, которые это уже умеют,
 * и стыкует их точка входа: сетка метрик внутри карточки снова может нарисовать карточку.
 */
export type ObjectCardPort = {
  find(address: string): MapObject | undefined;
  /** Клик по имени — объект на месте. */
  open(link: string): void;
  /** Ctrl + клик по имени — отдельным табом; хост без табов — поля нет (решение 0026). */
  openTab?: ((link: string) => void) | undefined;
  /** Сетка метрик вкладки — та же, что на экране объекта, со своей подпиской. */
  Grid: ComponentType<{
    object: MapObject;
    metrics: MapMetric[];
    layout?: Layout | undefined;
    group?: string | undefined;
  }>;
  /** Меню экшонов объекта — то же, что в шапке экрана. */
  Actions: ComponentType<{ object: MapObject }>;
  /** Меню директив объекта: пункт на пару «директива · этап». */
  Directives: ComponentType<{ object: MapObject }>;
  /** Меню терминалов объекта; хост без терминалов — поля нет. */
  Terminal?: ComponentType<{ object: MapObject }> | undefined;
};

const ObjectCardContext = createContext<ObjectCardPort | undefined>(undefined);

export function ProvideObjectCard(props: { port: ObjectCardPort; children: ReactNode }) {
  return <ObjectCardContext value={props.port}>{props.children}</ObjectCardContext>;
}

export function useObjectCardPort(): ObjectCardPort {
  const port = useContext(ObjectCardContext);
  if (!port) throw new Error("ProvideObjectCard is missing above the object card");
  return port;
}
