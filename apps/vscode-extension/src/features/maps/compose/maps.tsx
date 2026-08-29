import type { ReactNode } from "react";
import type { ResolvedMap } from "@/kernel/bridge/config.ts";
import { useMaps, useMapsActions } from "@/features/maps/adapters/use-maps.ts";
import { Accordion } from "@/features/maps/ui/accordion.tsx";
import { Empty } from "@/features/maps/ui/empty.tsx";
import { Loading } from "@/features/maps/ui/loading.tsx";

/**
 * The feature knows how many maps there are and nothing about what a map looks like — that
 * arrives through `renderMap`.
 */
export function Maps(props: { renderMap: (map: ResolvedMap) => ReactNode }) {
  const state = useMaps();
  const actions = useMapsActions();

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

  return (
    <Accordion
      sections={state.maps.map((map) => ({
        key: map.mapPath,
        title: map.name,
        body: props.renderMap(map),
      }))}
    />
  );
}
