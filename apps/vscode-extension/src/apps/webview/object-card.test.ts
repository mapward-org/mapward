import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import type { MapMetric, MapObject } from "@mapward/core";
import { ObjectCard } from "../../../../../packages/abstract-react-client/src/features/object-card/compose/object-card.tsx";
import {
  ProvideObjectCard,
  type ObjectCardPort,
} from "../../../../../packages/abstract-react-client/src/features/object-card/ports.tsx";
import { Display } from "../../../../../packages/abstract-react-client/src/features/metrics/compose/displays.tsx";

/**
 * Карточка объекта — превью на чужом экране. У клиента нет `react-dom`, поэтому первый кадр
 * проверяется здесь: что шапка, сообщение и сетка вкладки встают по местам, а пункт с `object`
 * рисуется карточкой, а не строкой.
 */

const core = {
  address: "mapward://packages/core",
  name: "core",
  prototypeName: "Пакет",
  isGroup: false,
  actions: [],
  metrics: [{ key: "code" }, { key: "tests" }] as MapMetric[],
  metricGroups: [
    { key: "всё", metrics: ["code", "tests"] },
    { key: "превью", metrics: ["tests"], defaultPreview: true },
  ],
} as unknown as MapObject;

const port: ObjectCardPort = {
  find: (address: string) => (address === core.address ? core : undefined),
  open: () => {},
  Grid: (props: { metrics: MapMetric[]; group?: string | undefined }) =>
    createElement("i", null, `сетка ${props.group}: ${props.metrics.map((m) => m.key).join(",")}`),
  Actions: () => createElement("i", null, "экшоны"),
  Directives: () => createElement("i", null, "директивы"),
};

const card = (item: { object: string; group?: string; width?: number }) =>
  renderToString(
    createElement(ProvideObjectCard, { port, children: createElement(ObjectCard, { item }) }),
  );

test("карточка — шапка с прототипом и сетка вкладки превью", () => {
  const html = card({ object: core.address, width: 280 });
  expect(html).toContain("Пакет<!-- -->: </span>core");
  expect(html).toContain("директивы");
  expect(html).toContain("сетка превью: tests");
  expect(html).toContain("width:280px");
  // Экшонов у объекта нет — и кнопки нет.
  expect(html).not.toContain("экшоны");
});

test("названная вкладка — она, а не превью", () => {
  expect(card({ object: core.address, group: "всё" })).toContain("сетка всё: code,tests");
});

test("чего нет, карточка так и говорит", () => {
  const noGroup = card({ object: core.address, group: "тяжёлое" });
  expect(noGroup).toContain("нет вкладки тяжёлое");
  expect(noGroup).not.toContain("сетка");
  expect(card({ object: "mapward://nowhere" })).toContain("нет объекта nowhere");
});

test("пункт списка с object рисуется карточкой, остальные — строками", () => {
  const html = renderToString(
    createElement(Display, {
      data: {
        kind: "list",
        items: [
          { label: "строка", link: "a.md" },
          { object: core.address, label: "не видно" },
        ],
      },
      collected: true,
      onOpen: () => {},
      renderMap: () => null,
      renderComponent: () => null,
      renderObject: (item) => createElement("b", null, `карточка ${item.object}`),
    }),
  );
  expect(html).toContain("строка");
  expect(html).toContain("карточка mapward://packages/core");
  expect(html).not.toContain("не видно");
});
