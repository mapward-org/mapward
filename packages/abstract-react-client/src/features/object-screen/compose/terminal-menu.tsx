import type { MapObject } from "@mapward/core";
import { useWatch } from "../../../lib/store/use-watch.ts";
import type { Terminals } from "../adapters/terminals.ts";
import { useTerminals } from "../ports.tsx";
import { FreshTerminal, TerminalItem, TerminalMenu } from "../ui/terminal-menu.tsx";

/**
 * Меню терминалов объекта. У экрана оно спрашивает список сразу: пустой — и клик сразу заводит
 * разговор. У карточки — `lazy`: список спрашивается, только когда меню открыли, иначе каждая
 * карточка на карте стоила бы запроса к редактору. Спрашивает тот, кто подписан на ресурс
 * списка: кнопка — сразу, а у `lazy` — только открытый список.
 */
export function ObjectTerminalMenu(props: {
  object: MapObject;
  terminals: Terminals;
  lazy?: boolean | undefined;
}) {
  const { terminals } = props;
  useWatch(terminals, props.lazy ? undefined : terminals.watch(props.object.address));

  return (
    <TerminalMenu
      empty={!props.lazy && terminals.list(props.object.address).length === 0}
      onOpen={() => terminals.open(props.object.address)}
    >
      {(close) => <TerminalList object={props.object} terminals={terminals} close={close} />}
    </TerminalMenu>
  );
}

/** Открытый список: пока он на экране, на список терминалов объекта подписаны. */
function TerminalList(props: { object: MapObject; terminals: Terminals; close: () => void }) {
  const { terminals } = props;
  useWatch(terminals, terminals.watch(props.object.address));

  return (
    <>
      <FreshTerminal
        close={props.close}
        onFresh={() => terminals.open(props.object.address, true)}
      />
      {terminals.list(props.object.address).map((terminal) => (
        <TerminalItem
          key={terminal.id}
          terminal={terminal}
          close={props.close}
          onShow={(id) => terminals.show(id)}
          onClose={(id) => terminals.close(id)}
        />
      ))}
    </>
  );
}

/** Меню терминалов карточки: объект — её, терминалы — общие на вид, от точки входа. */
export function CardTerminalMenu(props: { object: MapObject }) {
  const terminals = useTerminals();

  return <ObjectTerminalMenu object={props.object} terminals={terminals} lazy />;
}
