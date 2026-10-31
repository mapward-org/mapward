import type { ComponentType, ReactNode } from "react";
import type { EditResult, MapOp } from "../model/ops.ts";

/** Что карточке объекта нужно знать: адрес, группа метрик превью и размеры — как у `ObjectCard`. */
export type CardItem = {
  object: string;
  group?: string;
  width?: string | number;
  maxHeight?: string | number;
};

/** Карточка объекта — кирпич `ObjectCard` из `@mapward/component`: с кнопками в шапке и ручкой. */
export type CardView = ComponentType<
  CardItem & { actions?: ReactNode; draggable?: boolean | undefined }
>;

/**
 * Что холсту нужно снаружи: правка карты, куда ведёт узел и карточка объекта. Правку считает и
 * пишет процесс этого плагина (решение 0044), холст только зовёт её; порт собирает `view.tsx` из
 * методов плагина и навигации карты.
 */
export type CanvasPort = {
  /** Карта, которой принадлежит вьюха: копия с холста вставляется только в свою карту. */
  mapPath: string;
  /** Пачка операций: применяется по очереди и отменяется целиком. */
  edit(ops: MapOp[]): Promise<EditResult>;
  undo(id: string): Promise<EditResult>;
  redo(id: string): Promise<EditResult>;
  open(link: string): void;
  /** Открыть узел отдельным табом — ctrl + клик (решение 0026); хост без табов — поля нет. */
  openTab?: ((link: string) => void) | undefined;
  Card: CardView;
};

/** Ручка в шапке `ObjectCard` с `draggable`: за неё холст тащит карточку, а не за всё тело. */
export const cardClasses = { dragHandle: "mw-card-drag" } as const;
