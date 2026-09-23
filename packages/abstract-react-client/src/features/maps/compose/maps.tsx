import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";
import type { ResolvedMap } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useViewStates } from "../../../services/state/ports.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { MapsList } from "../adapters/maps-list.ts";
import { MapsView } from "../model/maps-view.ts";
import { Accordion, AccordionSection, Searching } from "../ui/accordion.tsx";
import { Empty } from "../ui/empty.tsx";

/**
 * The feature knows how many maps there are and nothing about what a map looks like — that
 * arrives through `renderMap`.
 */
export const Maps = observer(function Maps(props: { renderMap: (map: ResolvedMap) => ReactNode }) {
  const bridge = useBridgeClient();
  const views = useViewStates();
  const maps = useLocalStore(
    () => new MapsView(new MapsList(bridge), views.slot<string[]>("maps:closed", [])),
  );
  const { screen } = maps;

  return screen.kind === "loading" ? (
    <Searching />
  ) : screen.kind === "empty" ? (
    <Empty text={screen.text} action={screen.action} onAction={screen.onAction} />
  ) : screen.kind === "one" ? (
    <>{props.renderMap(screen.map)}</>
  ) : (
    <Accordion>
      {screen.sections.map((section) => (
        <AccordionSection
          key={section.map.mapPath}
          title={section.map.name}
          open={section.open}
          mounted={section.mounted}
          onToggle={() => maps.toggle(section.map.mapPath)}
        >
          {props.renderMap(section.map)}
        </AccordionSection>
      ))}
    </Accordion>
  );
});
