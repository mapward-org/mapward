import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { Layout, MapMetric, MapObject } from "@mapward/core";

/**
 * Что экран объекта ставит по местам — решение 0042. Экран не знает, что это за фичи: он
 * объявляет, какие части ему нужны и что он им передаёт, а фичи подкладывает точка входа.
 */
export type ScreenSlots = {
  /** Сетка метрик вкладки; одна метрика во всю ширину — с `solo`. */
  Metrics: ComponentType<{
    object: MapObject;
    metrics: MapMetric[];
    layout?: Layout | undefined;
    group?: string | undefined;
    solo?: string | undefined;
  }>;
  /** Незакрытые директивы под названием объекта. */
  Directives: ComponentType<{ object: MapObject }>;
  /** Мета-экран: всё, что объект о себе знает. */
  Meta: ComponentType<{ object: MapObject }>;
  /** Экран прогонов; выбранный прогон едет в истории экрана. */
  Runs: ComponentType<{ selected: string | undefined; onSelect: (id: string) => void }>;
  /** Меню всех экшонов объекта в шапке. */
  ActionMenu: ComponentType<{ object: MapObject }>;
  /** Форма запуска экшона — поверх экрана. */
  ActionForm: ComponentType;
  /** Разметка описания вкладки. */
  Markdown: ComponentType<{ text: string; onOpen: (link: string) => void }>;
};

const SlotsContext = createContext<ScreenSlots | undefined>(undefined);

export function ProvideScreenSlots(props: { slots: ScreenSlots; children: ReactNode }) {
  return <SlotsContext value={props.slots}>{props.children}</SlotsContext>;
}

export function useScreenSlots(): ScreenSlots {
  const slots = useContext(SlotsContext);
  if (!slots) throw new Error("ProvideScreenSlots is missing above the object screen");
  return slots;
}
