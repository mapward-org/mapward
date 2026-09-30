import { expect, test } from "vitest";
import { clipText, pasteOps, readClip, topsOf } from "./copy.ts";

const clip = {
  map: "/maps/one",
  objects: [
    { address: "mapward://es/оплата", at: { x: 100, y: 100 } },
    { address: "mapward://es/оплата/заказ", at: { x: 120, y: 140 } },
    { address: "mapward://es/игры/платёж", at: { x: 300, y: 200 } },
  ],
  shapes: [
    { id: "s1", kind: "rect" as const, x: 80, y: 120, width: 10, height: 10 },
    { id: "s2", kind: "line" as const, x: 0, y: 0, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
  ],
};

test("the clipboard text is ours only when it carries our mark", () => {
  expect(readClip(clipText(clip))?.objects).toHaveLength(3);
  expect(readClip("просто текст")).toBeUndefined();
  expect(readClip('{"map":"x"}')).toBeUndefined();
});

test("a resident of a copied group rides with it", () => {
  expect(topsOf(clip.objects).map((item) => item.address)).toEqual([
    "mapward://es/оплата",
    "mapward://es/игры/платёж",
  ]);
});

test("the paste puts the copy's top left corner under the cursor, in the group under it", () => {
  const read = readClip(clipText(clip));
  if (!read) throw new Error("no clip");
  const ops = pasteOps({
    view: "mapward://_metrics/canvas",
    clip: read,
    point: { x: 1000, y: 500 },
    target: "mapward://es/игры",
    relative: (_, point) => ({ x: point.x - 900, y: point.y - 400 }),
    newShapeId: () => "new",
  });
  // Линия не копируется: её концы бывают прицеплены к узлам, которых у копии ещё нет.
  expect(ops).toEqual([
    {
      op: "put-shape",
      view: "mapward://_metrics/canvas",
      shape: { id: "new", kind: "rect", x: 1000, y: 520, width: 10, height: 10 },
    },
    {
      op: "copy-objects",
      view: "mapward://_metrics/canvas",
      objects: ["mapward://es/оплата", "mapward://es/игры/платёж"],
      parent: "mapward://es/игры",
      positions: {
        "mapward://es/оплата": { x: 120, y: 100 },
        "mapward://es/игры/платёж": { x: 320, y: 200 },
      },
    },
  ]);
});

test("without a cursor the copy lands a little aside, in the view's place for new objects", () => {
  const read = readClip(clipText({ ...clip, shapes: [] }));
  if (!read) throw new Error("no clip");
  const [op] = pasteOps({
    view: "v",
    clip: read,
    point: undefined,
    target: undefined,
    relative: (_, point) => point,
    newShapeId: () => "new",
  });
  expect(op).toMatchObject({
    op: "copy-objects",
    positions: { "mapward://es/оплата": { x: 124, y: 124 } },
  });
  expect(op && "parent" in op).toBe(false);
});
