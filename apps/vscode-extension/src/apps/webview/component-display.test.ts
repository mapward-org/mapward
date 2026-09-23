import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { ComponentDisplay } from "../../../../../packages/abstract-react-client/src/features/map-object/_metrics/ui/component-display.tsx";

/**
 * Ячейка дисплея-компонента — решение 0037. У клиента нет `react-dom`, поэтому рендер проверяется
 * здесь, первым кадром на сервере. Ловушку ошибок отрисовки так не проверить: серверный рендер
 * её не зовёт.
 */

const display = {
  data: { items: [{ label: "урок 1", status: "success" }] },
  object: { address: "mapward://", name: "Корень", path: "/map", props: {} },
  metric: { key: "tx", address: "mapward://_metrics/tx", label: "Транскрибация", busy: false },
  open: () => {},
};

const links = { onOpen: () => {} };

const render = (props: Partial<Parameters<typeof ComponentDisplay>[0]>) =>
  renderToString(createElement(ComponentDisplay, { build: undefined, display, links, ...props }));

test("собранный компонент рисуется с набором карты и своим css", () => {
  const code = [
    'var jsx = require("react/jsx-runtime");',
    'var kit = require("@mapward/display");',
    "module.exports = { default: function View(props) {",
    '  return jsx.jsxs("section", { className: "p-2", children: [props.metric.label, jsx.jsx(kit.List, { items: props.data.items })] });',
    "} };",
  ].join("\n");
  const html = render({ build: { code, css: ".p-2{padding:8px}", builtAt: "now" } });

  expect(html).toContain("Транскрибация");
  expect(html).toContain("урок 1");
  expect(html).toContain(".p-2{padding:8px}");
});

test("не собрался — ошибки сборки в ячейке", () => {
  const html = render({
    build: { errors: ["display.tsx:1:8: не найден пакет x"], builtAt: "now" },
  });
  expect(html).toContain("компонент не собрался");
  expect(html).toContain("не найден пакет x");
});

test("данные не прошли схему — компонент не рисуется", () => {
  const html = render({
    build: { code: "module.exports = { default: () => 'рисую' };", builtAt: "now" },
    invalid: ["/items/0/done: must be boolean"],
  });
  expect(html).toContain("данные не прошли схему");
  expect(html).not.toContain("рисую");
});

test("сборка ещё идёт", () => {
  expect(render({})).toContain("собирается");
});
