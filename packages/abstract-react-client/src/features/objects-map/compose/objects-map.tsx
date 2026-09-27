import { observer } from "mobx-react-lite";
import type { ObjectsMap } from "@mapward/core";
import { useViewStates } from "../../../services/state/ports.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { ObjectsMapStore } from "../model/objects-map.ts";
import { toolItems } from "../pure-model/tools.ts";
import { useObjectsMapPort } from "../ports.tsx";
import { Graph } from "../ui/flow.tsx";
import {
  Confirm,
  DiveButton,
  MapFrame,
  Message,
  PopoverFrame,
  RelationList,
  ToolbarFrame,
  ToolButton,
  ToolHeading,
  UndoRedo,
} from "../ui/parts.tsx";

/**
 * Вьюха карты — значение метрики `objects-map` (решение 0044): что показать, как нарисовать и
 * куда тянутся стрелки, собрал сервер, а здесь это ложится на холст. Холст ничего не решает сам:
 * каждое действие — операция правки на сервере, и новая картинка приходит новым значением.
 */
export const ObjectsMapView = observer(function ObjectsMapView(props: {
  map: ObjectsMap;
  address: string;
}) {
  const port = useObjectsMapPort();
  const views = useViewStates();
  const store = useLocalStore(
    () => new ObjectsMapStore(port, views, props.address),
    [props.address],
  );
  const popover = store.popover;

  return (
    <MapFrame>
      <ToolbarFrame>
        {toolItems(props.map.palette).map((item) =>
          "heading" in item ? (
            <ToolHeading key={item.key} text={item.heading} />
          ) : (
            <ToolButton
              key={item.key}
              on={store.isTool(item.tool)}
              title={item.title}
              label={item.label}
              onClick={() => store.choose(item.tool)}
            />
          ),
        )}
        <UndoRedo
          canUndo={store.canUndo}
          canRedo={store.canRedo}
          onUndo={() => store.undo()}
          onRedo={() => store.redo()}
        />
      </ToolbarFrame>
      <Graph
        map={props.map}
        viewport={store.view}
        tool={store.tool}
        renaming={store.renaming}
        onOpenTab={port.openTab}
        onViewport={(viewport) => store.pan(viewport)}
        onEdit={(ops) => store.edit(ops)}
        onPopover={(next) => (next ? store.open(next) : store.closePopover())}
        onRename={(id) => store.rename(id)}
        onDelete={(target) => store.ask(target)}
        onSay={(message) => store.say(message)}
        onToolDone={() => store.choose({ kind: "select" })}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        renderCard={(item) => <port.Card item={item} />}
      />
      {store.confirmText && (
        <Confirm
          text={store.confirmText}
          onYes={() => store.remove(props.map.view)}
          onNo={() => store.cancel()}
        />
      )}
      {popover && (
        <PopoverFrame onClose={() => store.closePopover()}>
          {popover.kind === "object" ? (
            <>
              <port.Card item={{ object: popover.address }} />
              <DiveButton onDive={() => store.dive(popover.address)} />
            </>
          ) : (
            <RelationList
              items={popover.items}
              onPick={(link) => store.open({ kind: "object", address: link })}
            />
          )}
        </PopoverFrame>
      )}
      {store.message && <Message text={store.message} onClose={() => store.say(undefined)} />}
    </MapFrame>
  );
});
