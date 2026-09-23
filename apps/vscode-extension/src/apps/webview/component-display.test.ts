import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { ComponentDisplay } from "../../../../../packages/abstract-react-client/src/features/metrics/compose/component-display.tsx";
import { Display } from "../../../../../packages/abstract-react-client/src/features/metrics/compose/displays.tsx";

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
  actions: [],
  run: () => {},
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

/** Решение 0038: кнопку строки и `ActionButton` набора рисует сетка — через тот же контекст. */
test("экшон строки и ActionButton набора рисует то, что дала ячейка", () => {
  const code = [
    'var jsx = require("react/jsx-runtime");',
    'var kit = require("@mapward/display");',
    "module.exports = { default: function View() {",
    '  return jsx.jsxs("div", { children: [',
    '    jsx.jsx(kit.List, { items: [{ label: "тест", action: { run: "rerun", inputs: { f: 1 } } }] }),',
    '    jsx.jsx(kit.ActionButton, { action: "release", label: "Выпустить" }),',
    "  ] });",
    "} };",
  ].join("\n");
  const html = render({
    build: { code, builtAt: "now" },
    links: {
      onOpen: () => {},
      renderRowAction: (action) => `[строка ${action.run} ${JSON.stringify(action.inputs)}]`,
      renderActionButton: (action, label) => `[кнопка ${action.run} ${label}]`,
    },
  });
  expect(html).toContain("тест");
  expect(html).toContain("[строка rerun {&quot;f&quot;:1}]");
  expect(html).toContain("[кнопка release Выпустить]");
});

/** Раскрытие папок `FileTree` набора едет контекстом по `id` дерева — запоминает сетка. */
test("FileTree набора раскрыт по сохранённому состоянию своего id", () => {
  const code = [
    'var jsx = require("react/jsx-runtime");',
    'var kit = require("@mapward/display");',
    'var items = [{ label: "src", isDir: true, children: [{ label: "core.ts" }] }];',
    "module.exports = { default: function View() {",
    '  return jsx.jsxs("div", { children: [',
    '    jsx.jsx("p", { children: "левое" }), jsx.jsx(kit.FileTree, { id: "left", items: items }),',
    "  ] });",
    "} };",
  ].join("\n");
  const asked: string[] = [];
  const open = (opened: boolean) =>
    render({
      build: { code, builtAt: "now" },
      links: {
        onOpen: () => {},
        treeOpen: (id) => {
          asked.push(id);
          return { ready: true, isOpen: (path) => opened && path === "src", toggle: () => {} };
        },
      },
    });

  expect(open(true)).toContain("core.ts");
  expect(open(false)).not.toContain("core.ts");
  expect(asked).toContain("left");
});

test("пока сохранённое не пришло, дерево набора не рисуется", () => {
  const code = [
    'var jsx = require("react/jsx-runtime");',
    'var kit = require("@mapward/display");',
    "module.exports = { default: function View() {",
    '  return jsx.jsx(kit.FileTree, { items: [{ label: "src", isDir: true }] });',
    "} };",
  ].join("\n");
  const html = render({
    build: { code, builtAt: "now" },
    links: {
      onOpen: () => {},
      treeOpen: () => ({ ready: false, isOpen: () => false, toggle: () => {} }),
    },
  });
  expect(html).not.toContain("src");
});

/** Встроенный дисплей `tree` с раскрытыми папками `opened`. */
const tree = (opened: string[]) =>
  renderToString(
    createElement(Display, {
      data: {
        kind: "tree",
        children: [
          {
            label: "src",
            isDir: true,
            children: [{ label: "ui", isDir: true, children: [{ label: "row.tsx" }] }],
          },
        ],
      },
      collected: true,
      onOpen: () => {},
      renderMap: () => null,
      renderComponent: () => null,
      treeOpen: { ready: true, isOpen: (path) => opened.includes(path), toggle: () => {} },
    }),
  );

test("встроенное дерево раскрыто по сохранённому состоянию", () => {
  expect(tree(["src", "src/ui"])).toContain("row.tsx");
  // Вложенная папка помнит себя, но под закрытой родительской не видна.
  expect(tree(["src/ui"])).not.toContain("row.tsx");
});
