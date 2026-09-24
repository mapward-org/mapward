import { expect, test } from "vitest";
import type { MapObject } from "@mapward/core";
import { cardView, cssSize } from "./card.ts";

const metric = (key: string) =>
  ({ key, address: `mapward://core/_metrics/${key}`, config: {}, layers: [] }) as never;

const core = {
  address: "mapward://core",
  name: "core",
  isGroup: false,
  metrics: [metric("files"), metric("tests")],
  metricGroups: [
    { key: "код", metrics: ["files"] },
    { key: "превью", metrics: ["tests"], defaultPreview: true },
  ],
} as unknown as MapObject;

test("a card shows the preview group of its object", () => {
  const view = cardView(core, core.address);
  expect(view.kind).toBe("preview");
  expect(view.kind === "preview" && view.metrics.map((one) => one.key)).toEqual(["tests"]);

  const named = cardView(core, core.address, "код");
  expect(named.kind === "preview" && named.group.key).toBe("код");
});

test("a card says what is missing instead of showing something else", () => {
  expect(cardView(undefined, "mapward://nowhere")).toEqual({
    kind: "missing-object",
    note: "нет объекта nowhere",
  });
  expect(cardView(core, core.address, "тяжёлое")).toMatchObject({
    kind: "missing-group",
    note: "нет вкладки тяжёлое",
  });
  // Превью у объекта нет — одна шапка, без метрик и без подписки.
  const plain = { ...core, metricGroups: [] } as unknown as MapObject;
  expect(cardView(plain, core.address).kind).toBe("header");
});

test("a size is css, a number is pixels", () => {
  expect(cssSize(280)).toBe("280px");
  expect(cssSize("50%")).toBe("50%");
  expect(cssSize(undefined)).toBeUndefined();
});
