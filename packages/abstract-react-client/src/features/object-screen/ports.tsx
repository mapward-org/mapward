import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { Layout, MapMetric, MapObject } from "@mapward/core";
import type { Terminals } from "./adapters/terminals.ts";

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

/**
 * Терминалы вида — одни на все объекты: объект называется в каждом вызове. Экрану их отдают
 * пропсом, а карточке, которая стоит на чужом экране, — отсюда (решение 0042).
 */
const TerminalsContext = createContext<Terminals | undefined>(undefined);

export function ProvideTerminals(props: { terminals: Terminals; children: ReactNode }) {
  return <TerminalsContext value={props.terminals}>{props.children}</TerminalsContext>;
}

export function useTerminals(): Terminals {
  const terminals = useContext(TerminalsContext);
  if (!terminals) throw new Error("ProvideTerminals is missing above the terminal menu");
  return terminals;
}
