import { expect, test } from "vitest";
import { anchored, endPoint, floating, snapToFrame } from "./anchors.ts";

const frame = { x: 0, y: 0, width: 100, height: 50 };

test("a floating end leaves from the side that faces the other end", () => {
  expect(floating(frame, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 });
  expect(floating(frame, { x: 50, y: -200 })).toEqual({ x: 50, y: 0 });
  expect(floating(frame, { x: -100, y: 25 })).toEqual({ x: 0, y: 25 });
});

test("a diagonal ray hits the side it reaches first", () => {
  // Узел шире, чем выше: луч под 45° упирается в нижнюю сторону.
  expect(floating(frame, { x: 150, y: 125 })).toEqual({ x: 75, y: 50 });
});

test("a pinned end sits at its share of the frame and follows a resize", () => {
  expect(anchored(frame, { x: 1, y: 0.5 })).toEqual({ x: 100, y: 25 });
  expect(anchored({ ...frame, width: 200 }, { x: 1, y: 0.5 })).toEqual({ x: 200, y: 25 });
  expect(endPoint(frame, undefined, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 });
});

test("a dragged end snaps onto the nearest side of the frame", () => {
  expect(snapToFrame(frame, { x: 30, y: -10 })).toEqual({ x: 0.3, y: 0 });
  expect(snapToFrame(frame, { x: 95, y: 20 })).toEqual({ x: 1, y: 0.4 });
  expect(snapToFrame(frame, { x: 50, y: 49 })).toEqual({ x: 0.5, y: 1 });
});
