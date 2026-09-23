import type { ReactNode } from "react";
import type { ResolvedMap } from "@mapward/core";
import { useMaps, useMapsActions } from "../adapters/use-maps.ts";
import { Accordion } from "../ui/accordion.tsx";
import { Empty } from "../ui/empty.tsx";
import { Loading } from "../../../lib/ui/loading.tsx";
import { useViewState } from "../../../services/state/index.ts";

/**
 * The feature knows how many maps there are and nothing about what a map looks like — that
 * arrives through `renderMap`.
 */
export function Maps(props: { renderMap: (map: ResolvedMap) => ReactNode }) {
  const state = useMaps();
  const actions = useMapsActions();
  // Свёрнутые карты — путями, списком: множество в хранилище редактора не ляжет. Путь карты,
  // которой больше нет, просто лежит — вернётся карта, вернётся и её свёрнутость.
  const [closedList, setClosedList, loaded] = useViewState<string[]>("maps:closed", []);

  if (!state) return <Loading text="Ищем карты…" />;

  if (state.kind === "no-workspace") {
    return (
      <Empty
        text="Не открыта папка. Открой проект, в котором есть карта."
        action="Найти"
        onAction={actions.pickFolder}
      />
    );
  }

  if (state.kind === "error") {
    return (
      <Empty
        text={state.message}
        action={state.configPath ? "Открыть mapward.json" : "Создать mapward.json"}
        onAction={() =>
          state.configPath ? actions.openPath(state.configPath) : actions.createConfig()
        }
      />
    );
  }

  if (state.kind === "no-config") {
    return (
      <Empty
        text="В проекте нет mapward.json — карту неоткуда взять."
        action="Создать mapward.json"
        onAction={actions.createConfig}
      />
    );
  }

  // One map needs no chooser: the sidebar shows it as if there were no choice at all.
  const [only] = state.maps;
  if (state.maps.length === 1 && only) return <>{props.renderMap(only)}</>;

  // Пока хранилище не ответило, неизвестно, какие карты свёрнуты: нарисованная раньше свёрнутая
  // карта успела бы смонтироваться и начать грузиться.
  if (!loaded) return <Loading text="Ищем карты…" />;

  const closed = new Set(closedList);
  const toggle = (key: string) =>
    setClosedList(closed.has(key) ? closedList.filter((k) => k !== key) : [...closedList, key]);

  return (
    <Accordion
      closed={closed}
      onToggle={toggle}
      sections={state.maps.map((map) => ({
        key: map.mapPath,
        title: map.name,
        body: props.renderMap(map),
      }))}
    />
  );
}
