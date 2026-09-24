import { observer } from "mobx-react-lite";
import type { MapObject } from "@mapward/core";
import type { Terminals } from "../adapters/terminals.ts";
import { useTerminals } from "../ports.tsx";
import { FreshTerminal, TerminalItem, TerminalMenu } from "../ui/terminal-menu.tsx";

/**
 * Меню терминалов объекта. У экрана оно спрашивает список сразу: пустой — и клик сразу заводит
 * разговор. У карточки — `lazy`: список спрашивается, только когда меню открыли, иначе каждая
 * карточка на карте стоила бы запроса к редактору.
 */
export const ObjectTerminalMenu = observer(function ObjectTerminalMenu(props: {
  object: MapObject;
  terminals: Terminals;
  lazy?: boolean | undefined;
}) {
  const { terminals } = props;

  return (
    <TerminalMenu
      empty={!props.lazy && terminals.list(props.object.address).length === 0}
      onOpen={() => terminals.open(props.object.address)}
    >
      {(close) => (
        <>
          <FreshTerminal close={close} onFresh={() => terminals.open(props.object.address, true)} />
          {terminals.list(props.object.address).map((terminal) => (
            <TerminalItem
              key={terminal.id}
              terminal={terminal}
              close={close}
              onShow={(id) => terminals.show(id)}
              onClose={(id) => terminals.close(id)}
            />
          ))}
        </>
      )}
    </TerminalMenu>
  );
});

/** Меню терминалов карточки: объект — её, терминалы — общие на вид, от точки входа. */
export const CardTerminalMenu = observer(function CardTerminalMenu(props: { object: MapObject }) {
  const terminals = useTerminals();

  return <ObjectTerminalMenu object={props.object} terminals={terminals} lazy />;
});
