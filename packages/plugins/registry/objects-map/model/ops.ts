import { schemaErrors } from "@mapward/plugin";
import { array, literal, number, object, record, string, union } from "./schema.ts";
import { ArrowStyle, PointSchema, Side, ViewShape } from "./types.ts";
import type { Point } from "./types.ts";

/**
 * Язык холста — решение 0044. Холст говорит операциями, агент — теми же операциями через метод
 * `edit`; считает правку процесс плагина (`plan.ts`). Здесь только слова, общие у холста и
 * процесса: операция, её схема для агента и ответ на пачку.
 */

/** Операции холста — они же операции агента через плагин, с теми же аргументами. */
export type MapOp =
  | {
      op: "create-object";
      view: string;
      name: string;
      /** Адрес прототипа из палитры; не назван — первый из палитры, пустой палитры — без него. */
      prototype?: string;
      /** Группа, на которую бросили; не названа — место для новых объектов из конфига вьюхи. */
      parent?: string;
      position?: Point;
      /** Размер, которым объект нарисовали протяжкой, — у фрейма; нет — размер из стиля. */
      size?: { width: number; height: number };
    }
  | {
      op: "create-relation";
      view: string;
      from: string;
      to: string;
      prototype?: string;
      name?: string;
      /**
       * Стороны узлов, к которым крепятся концы: холст знает, за какую тянули и на какую
       * отпустили. Не названа — сторона, обращённая к другому узлу.
       */
      fromSide?: Side;
      toSide?: Side;
    }
  | {
      op: "move-object";
      object: string;
      /** Новый родитель: объект, полка или корень карты. */
      parent: string;
      view?: string;
      position?: Point;
    }
  | {
      op: "rename";
      object: string;
      label: string;
      /** Вьюха, чья подпись правится: у неё подписью может быть поле `props`, а не имя. */
      view?: string;
    }
  | {
      op: "set-folder";
      object: string;
      /** Новое имя папки, то есть последний шаг адреса; приводится к виду имени папки. */
      folder: string;
      view?: string;
    }
  | { op: "delete-object"; object: string }
  | {
      op: "copy-objects";
      view: string;
      /** Что копировать; лежащий внутри другого скопированного едет с ним и отдельно не копируется. */
      objects: string[];
      /** Куда класть копии; не назван — место для новых объектов из конфига вьюхи. */
      parent?: string;
      /** Позиции копий на этой вьюхе по адресам оригиналов — относительно родителя. */
      positions?: Record<string, Point>;
    }
  | { op: "add-ref"; view: string; object: string; position?: Point }
  | { op: "remove-ref"; view: string; object: string }
  | {
      op: "put-copy";
      view: string;
      /**
       * `id` копии-отображения — `<адрес объекта>#<номер>`. Нет такой — заводится, есть —
       * меняются её фрейм и позиция: так же, как фигуру, копию ставит и двигает одна операция.
       */
      copy: string;
      /** Фрейм, на котором копия лежит; не назван — лежит на холсте. */
      parent?: string;
      position?: Point;
    }
  /** Убрать копию-отображение вместе со связями, привязанными к ней; объект остаётся. */
  | { op: "remove-copy"; view: string; copy: string }
  | { op: "move-nodes"; view: string; positions: Record<string, Point> }
  | {
      op: "resize-nodes";
      view: string;
      sizes: Record<string, { width: number; height: number; scale?: number }>;
    }
  | {
      op: "set-bends";
      view: string;
      /** `id` стрелки из значения вьюхи; пустой список выпрямляет её. */
      arrow: string;
      bends: Point[];
    }
  | {
      op: "style-arrow";
      view: string;
      arrow: string;
      /** Поля стиля целиком: так отмена возвращает прежний стиль, а не его кусок. */
      style: ArrowStyle;
    }
  | { op: "put-shape"; view: string; shape: ViewShape }
  | { op: "remove-shape"; view: string; id: string };

const size = object({ width: number, height: number });

/** Схема `MapOp` — для агента в самоописании метода `edit` и для проверки пачки. */
export const MapOp = union(
  object(
    { op: literal("create-object"), view: string, name: string },
    { prototype: string, parent: string, position: PointSchema, size },
  ),
  object(
    { op: literal("create-relation"), view: string, from: string, to: string },
    { prototype: string, name: string, fromSide: Side, toSide: Side },
  ),
  object(
    { op: literal("move-object"), object: string, parent: string },
    { view: string, position: PointSchema },
  ),
  object({ op: literal("rename"), object: string, label: string }, { view: string }),
  object({ op: literal("set-folder"), object: string, folder: string }, { view: string }),
  object({ op: literal("delete-object"), object: string }),
  object(
    { op: literal("copy-objects"), view: string, objects: array(string) },
    { parent: string, positions: record(PointSchema) },
  ),
  object({ op: literal("add-ref"), view: string, object: string }, { position: PointSchema }),
  object({ op: literal("remove-ref"), view: string, object: string }),
  object(
    { op: literal("put-copy"), view: string, copy: string },
    { parent: string, position: PointSchema },
  ),
  object({ op: literal("remove-copy"), view: string, copy: string }),
  object({ op: literal("move-nodes"), view: string, positions: record(PointSchema) }),
  object({
    op: literal("resize-nodes"),
    view: string,
    sizes: record(object({ width: number, height: number }, { scale: number })),
  }),
  object({ op: literal("set-bends"), view: string, arrow: string, bends: array(PointSchema) }),
  object({ op: literal("style-arrow"), view: string, arrow: string, style: ArrowStyle }),
  object({ op: literal("put-shape"), view: string, shape: ViewShape }),
  object({ op: literal("remove-shape"), view: string, id: string }),
);

/** Операция холста или нет — по её схеме: агент шлёт что угодно, и проверять надо до плана. */
export const isMapOp = (value: unknown): value is MapOp => schemaErrors(MapOp, value).length === 0;

/** Ответ на пачку операций: номер, по которому её отменяют, или отказ с причиной. */
export type EditResult =
  | {
      ok: true;
      /** Номер пачки: по нему её отменяют. */
      id: string;
      /** Какие файлы пачка тронула — для отчёта агенту и человеку. */
      touched: string[];
    }
  | {
      ok: false;
      /** Почему отказ: имя занято, перенос внутрь себя, файлы поменяли мимо отмены. */
      error: string;
    };

export const EditResult = union(
  object({ ok: { const: true }, id: string, touched: array(string) }),
  object({ ok: { const: false }, error: string }),
);
