import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { MapMetric, MapObject, MetricGroup } from "@mapward/core";
import type { CardMap } from "./model/card-store.ts";

/**
 * Что карточке объекта нужно от соседей — решение 0042. Сама карточка умеет немного: найти
 * объект, выбрать вкладку и уложиться в размер. Всё внутри рисуют фичи, которые это уже умеют,
 * и стыкует их точка входа: сетка метрик внутри карточки снова может нарисовать карточку.
 * Объект карточка берёт у карты (`object`, `feed`) — он приходит с сервера ресурсом.
 */
export type ObjectCardPort = CardMap & {
  /** Клик по имени — объект на месте. */
  open(link: string): void;
  /** Ctrl + клик по имени — отдельным табом; хост без табов — поля нет (решение 0026). */
  openTab?: ((link: string) => void) | undefined;
  /**
   * Метрики вкладки — те же, что на экране объекта: её раскладкой или списком, со своими
   * подписками; карточка просит компактный вид.
   */
  Grid: ComponentType<{
    object: MapObject;
    metrics: MapMetric[];
    group?: MetricGroup | undefined;
    compact?: boolean | undefined;
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
