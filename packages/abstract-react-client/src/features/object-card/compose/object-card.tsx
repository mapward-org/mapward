import { observer } from "mobx-react-lite";
import type { ObjectRef } from "@mapward/core";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { CardStore } from "../model/card-store.ts";
import { useObjectCardPort } from "../ports.tsx";
import { CardBody, CardFrame, CardHead, CardName, CardNote } from "../ui/card.tsx";

/**
 * Карточка объекта — превью там, где объект встречается на чужом экране: узел карты детей, пункт
 * списка или дерева с `object`, дисплей `object`. Шапка — имя со ссылкой и кнопки терминала,
 * экшонов и директив этого объекта; тело — сетка метрик его вкладки превью, со своей подпиской.
 * Кнопки и сетку рисуют их фичи, карточка получает их портом (решение 0042).
 */
export const ObjectCard = observer(function ObjectCard(props: { item: ObjectRef }) {
  const port = useObjectCardPort();
  const card = useLocalStore(
    () => new CardStore((address) => port.find(address), props.item.object, props.item.group),
    [props.item.object, props.item.group],
  );

  return card.object === undefined ? (
    <CardFrame width={props.item.width}>
      <CardNote text={card.note ?? ""} />
    </CardFrame>
  ) : (
    <CardFrame
      width={props.item.width}
      maxHeight={props.item.maxHeight}
      header={
        <CardHead
          buttons={
            <>
              {port.Terminal && <port.Terminal object={card.object} />}
              {card.hasActions && <port.Actions object={card.object} />}
              <port.Directives object={card.object} />
            </>
          }
        >
          <CardName
            name={card.object.name}
            prototypeName={card.object.prototypeName}
            onOpen={() => port.open(card.address)}
            onOpenTab={port.openTab && (() => port.openTab?.(card.address))}
          />
        </CardHead>
      }
    >
      {card.note && <CardNote text={card.note} />}
      {card.preview && (
        <CardBody>
          <port.Grid
            object={card.preview.object}
            metrics={card.preview.metrics}
            layout={card.preview.layout}
            group={card.preview.group.key}
          />
        </CardBody>
      )}
    </CardFrame>
  );
});
