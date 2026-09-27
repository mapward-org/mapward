import { slug } from "@mapward/core";
import type { MapOp, ObjectsMap, Point, ViewNode, ViewRelation } from "@mapward/core";

/**
 * Ожидающие правки — решение 0044, кусок «холст показывает правку сразу». Значение вьюхи
 * приходит после записи, вотчера и пересборки коллектора — это сотни миллисекунд. Пока его нет,
 * холст рисует значение с наложенными поверх отправленными операциями.
 *
 * Правка снимается, когда значение её отражает: узел стоит где бросили, подпись та, узел с
 * новым адресом появился. Не «первым новым значением»: подписка метрик шлёт снимки и без
 * пересборки вьюхи, и такой снимок несёт старую картинку — правка, снятая по нему, роняла узел
 * назад, а следующий снимок возвращал вперёд. Отказ снимает правку сразу; страховка — срок
 * после ответа сервера, на случай правки, которую вьюха так и не покажет (объект ушёл с неё).
 */
export type PendingEdit = {
  key: number;
  ops: MapOp[];
  /** Значение вьюхи, при котором правку отправили: с ним сравнивают «появилось» и «исчезло». */
  sent: ObjectsMap;
};

const within = (inner: string, outer: string) =>
  outer === "mapward://" || inner === outer || inner.startsWith(`${outer}/`);

const child = (parent: string, folder: string) =>
  parent === "mapward://" ? `${parent}${folder}` : `${parent}/${folder}`;

const parentOf = (address: string) => {
  const rest = address.slice("mapward://".length);
  return rest.includes("/") ? address.slice(0, address.lastIndexOf("/")) : "mapward://";
};

const near = (a: Point | undefined, b: Point) =>
  a !== undefined && Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Отражает ли значение вьюхи одну операцию. */
function reflects(map: ObjectsMap, sent: ObjectsMap, op: MapOp): boolean {
  const node = (id: string) => map.nodes.find((item) => item.id === id);
  const appeared = (test: (item: ViewNode) => boolean) =>
    map.nodes.some((item) => test(item) && !sent.nodes.some((old) => old.id === item.id));
  switch (op.op) {
    case "move-nodes":
      return Object.entries(op.positions).every(([id, at]) => {
        const found = node(id);
        return found === undefined || near(found.position, at);
      });
    case "move-object": {
      const moved = child(op.parent, op.object.split("/").at(-1) ?? "");
      return moved === op.object
        ? op.position === undefined || near(node(moved)?.position, op.position)
        : node(moved) !== undefined || node(op.object) === undefined;
    }
    case "set-folder":
      return node(child(parentOf(op.object), slug(op.folder))) !== undefined;
    case "rename": {
      // Подпись стрелки — имя её связи: у стрелки, склеенной из одной связи, ссылка на неё.
      const arrow = map.relations.find((item) => item.link === op.object);
      return (node(op.object) ?? arrow)?.label === op.label.trim();
    }
    case "delete-object":
      return !map.nodes.some((item) => within(item.id, op.object));
    case "remove-ref":
      return node(op.object) === undefined;
    case "add-ref":
      return node(op.object) !== undefined;
    case "create-object":
      return appeared((item) => item.label === op.name.trim());
    case "create-relation": {
      // Связь склеивается со стрелкой той же пары: отражена, когда связей на паре стало больше.
      const count = (value: ObjectsMap) =>
        value.relations.find((arrow) => arrow.from === op.from && arrow.to === op.to)?.count ?? 0;
      return count(map) > count(sent);
    }
    case "put-shape":
      return same(
        map.shapes.find((shape) => shape.id === op.shape.id),
        op.shape,
      );
    case "remove-shape":
      return !map.shapes.some((shape) => shape.id === op.id);
    case "resize-nodes":
      return Object.entries(op.sizes).every(([id, size]) => {
        const found = node(id);
        return found === undefined || same(found.size, size);
      });
    case "set-bends": {
      const arrow = map.relations.find((item) => item.id === op.arrow);
      return arrow === undefined || same(arrow.bends ?? [], op.bends);
    }
    case "style-arrow": {
      const arrow = map.relations.find((item) => item.id === op.arrow);
      return arrow === undefined || same(arrow.style ?? {}, op.style);
    }
  }
}

/** Значение отразило правку целиком — её можно не накладывать. */
export const reflected = (map: ObjectsMap, entry: PendingEdit): boolean =>
  entry.ops.every((op) => reflects(map, entry.sent, op));

/** Узел, которого ещё нет у сервера: номер правки и операции в ней. */
export const pendingId = (key: number, index: number) => `pending:${key}:${index}`;

function apply(map: ObjectsMap, op: MapOp, id: string): ObjectsMap {
  const nodes = (change: (list: ViewNode[]) => ViewNode[]) => ({
    ...map,
    nodes: change(map.nodes),
  });
  switch (op.op) {
    case "move-nodes":
      return nodes((list) =>
        list.map((item) => {
          const position = op.positions[item.id];
          return position ? { ...item, position } : item;
        }),
      );
    case "resize-nodes":
      return nodes((list) =>
        list.map((item) => {
          const size = op.sizes[item.id];
          return size ? { ...item, size } : item;
        }),
      );
    case "move-object": {
      // Узел сразу под адресом, который даст сервер: папка переезжает к новому родителю. С
      // прежним адресом холст смонтировал бы узел второй раз, когда придёт значение, — и он
      // моргнул бы. Имя, занятое соседом, сервер поменяет — тогда смонтируется, но только раз.
      const moved = child(op.parent, op.object.split("/").at(-1) ?? "");
      const renamed = (address: string) =>
        within(address, op.object) ? moved + address.slice(op.object.length) : address;
      const inGroup = map.nodes.some((item) => item.id === op.parent && item.expanded);
      return {
        ...map,
        nodes: map.nodes.map((item) => {
          const next = {
            ...item,
            id: renamed(item.id),
            link: renamed(item.link),
            object: renamed(item.object),
            ...(item.parent === undefined ? {} : { parent: renamed(item.parent) }),
          };
          if (item.id !== op.object) return next;
          const { parent: _old, ...rest } = next;
          return {
            ...rest,
            ...(inGroup ? { parent: op.parent } : {}),
            ...(op.position ? { position: op.position } : {}),
          };
        }),
        relations: map.relations.map((arrow) => ({
          ...arrow,
          from: renamed(arrow.from),
          to: renamed(arrow.to),
        })),
      };
    }
    case "rename":
      return {
        ...map,
        nodes: map.nodes.map((item) =>
          item.id === op.object ? { ...item, label: op.label } : item,
        ),
        relations: map.relations.map((item) =>
          item.link === op.object ? { ...item, label: op.label } : item,
        ),
      };
    case "delete-object":
    case "remove-ref": {
      const gone = (address: string) =>
        op.op === "delete-object" ? within(address, op.object) : address === op.object;
      return {
        ...map,
        nodes: map.nodes.filter((item) => !gone(item.id)),
        relations: map.relations.filter((arrow) => !gone(arrow.from) && !gone(arrow.to)),
      };
    }
    case "create-object": {
      const pick = map.palette.objects.find((one) => one.prototype === op.prototype);
      const inGroup =
        op.parent !== undefined && map.nodes.some((item) => item.id === op.parent && item.expanded);
      const node: ViewNode = {
        id,
        kind: "object",
        label: op.name,
        link: id,
        object: id,
        ...(inGroup && op.parent !== undefined ? { parent: op.parent } : {}),
        shape: "rect",
        ...(pick?.color === undefined ? {} : { color: pick.color }),
        ...(pick?.textColor === undefined ? {} : { textColor: pick.textColor }),
        view: "simple",
        // Фрейм — рамкой сразу, и того размера, каким его нарисовали.
        expanded: pick?.frame === true,
        ...(op.position ? { position: op.position } : {}),
        ...(op.size ? { size: op.size } : {}),
      };
      return { ...map, nodes: [...map.nodes, node] };
    }
    case "create-relation": {
      const arrow: ViewRelation = {
        id,
        from: op.from,
        to: op.to,
        ...(op.name === undefined ? {} : { label: op.name }),
        count: 1,
        relations: [],
      };
      return { ...map, relations: [...map.relations, arrow] };
    }
    case "style-arrow":
      return {
        ...map,
        relations: map.relations.map((arrow) =>
          arrow.id === op.arrow ? { ...arrow, style: op.style } : arrow,
        ),
      };
    case "set-bends":
      return {
        ...map,
        relations: map.relations.map((arrow) => {
          if (arrow.id !== op.arrow) return arrow;
          const { bends: _old, ...rest } = arrow;
          return op.bends.length > 0 ? { ...rest, bends: op.bends } : rest;
        }),
      };
    case "put-shape": {
      const known = map.shapes.some((shape) => shape.id === op.shape.id);
      return {
        ...map,
        shapes: known
          ? map.shapes.map((shape) => (shape.id === op.shape.id ? op.shape : shape))
          : [...map.shapes, op.shape],
      };
    }
    case "remove-shape":
      return { ...map, shapes: map.shapes.filter((shape) => shape.id !== op.id) };
    case "add-ref":
    case "set-folder":
      // Адрес и чужой объект сервер знает, а холст нет: их покажет новое значение вьюхи.
      return map;
  }
}

/** Картинка холста: значение вьюхи и поверх него ещё не отражённые правки, по порядку. */
export function overlay(map: ObjectsMap, entries: PendingEdit[]): ObjectsMap {
  let picture = map;
  for (const entry of entries) {
    if (reflected(map, entry)) continue;
    entry.ops.forEach((op, index) => {
      picture = apply(picture, op, pendingId(entry.key, index));
    });
  }
  return picture;
}
