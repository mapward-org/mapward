import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NEVER } from "rxjs";
import { expect, test } from "vitest";
import type { MapMetric, MapObject, MetricGroup } from "@mapward/core";
import { ObjectCard } from "../../../../../packages/abstract-react-client/src/features/object-card/compose/object-card.tsx";
import {
  ProvideObjectCard,
  type ObjectCardPort,
} from "../../../../../packages/abstract-react-client/src/features/object-card/ports.tsx";

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

/** Объекты приходят с сервера; в первом кадре ответ уже есть: `core` — есть, прочие — нет. */
const port: ObjectCardPort = {
  object: (address: string) => (address === core.address ? core : undefined),
  feed: () => ({ changed$: NEVER, ready: true }),
  open: () => {},
  Grid: (props: { metrics: MapMetric[]; group?: MetricGroup | undefined; compact?: boolean }) =>
    createElement(
      "i",
      null,
      `сетка ${props.group?.key}: ${props.metrics.map((m) => m.key).join(",")}${props.compact ? " компактно" : ""}`,
    ),
  Actions: () => createElement("i", null, "экшоны"),
  Directives: () => createElement("i", null, "директивы"),
};

const card = (item: { object: string; group?: string; width?: number }, draggable?: boolean) =>
  renderToString(
    createElement(ProvideObjectCard, {
      port,
      children: createElement(ObjectCard, { item, ...(draggable ? { draggable } : {}) }),
    }),
  );

test("карточка — шапка одной строкой и компактная сетка вкладки превью", () => {
  const html = card({ object: core.address, width: 280 });
  // Шапка — одна строка: прототип и адрес только в подсказке на имени, прототип виден по цвету.
  expect(html).toContain('title="Пакет · packages/core"');
  expect(html).toContain(">core</button>");
  expect(html).not.toContain("Пакет<!-- --> · </span>");
  expect(html).toContain("директивы");
  expect(html).toContain("сетка превью: tests компактно");
  expect(html).toContain("width:280px");
  // Экшонов у объекта нет — и кнопки нет.
  expect(html).not.toContain("экшоны");
});

test("ручка перетаскивания — только когда место показа её попросило", () => {
  expect(card({ object: core.address })).not.toContain("Перетащить");
  expect(card({ object: core.address }, true)).toContain('title="Перетащить"');
});

test("названная вкладка — она, а не превью", () => {
  expect(card({ object: core.address, group: "всё" })).toContain("сетка всё: code,tests компактно");
});

test("чего нет, карточка так и говорит", () => {
  const noGroup = card({ object: core.address, group: "тяжёлое" });
  expect(noGroup).toContain("нет вкладки тяжёлое");
  expect(noGroup).not.toContain("сетка");
  expect(card({ object: "mapward://nowhere" })).toContain("нет объекта nowhere");
});
