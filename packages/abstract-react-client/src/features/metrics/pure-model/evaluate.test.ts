import { expect, test } from "vitest";
import { evaluateModule } from "./evaluate.ts";
import { toDisplay } from "./display.ts";

test("модуль получает на require то, что отдал клиент, и отдаёт экспорт по умолчанию", () => {
  const react = { marker: "react клиента" };
  const code = [
    'var r = require("react");',
    "module.exports = { default: function View() { return r.marker; } };",
  ].join("\n");
  const view = evaluateModule(code, { react }) as () => string;
  expect(view()).toBe("react клиента");
});

test("чужой модуль не подсовывается молча — ошибка называет его", () => {
  expect(() => evaluateModule('require("lodash")', {})).toThrow(/lodash/);
});

test("данные компонента идут как есть: их проверила схема на сервере", () => {
  const data = { anything: [1, 2] };
  expect(toDisplay("component", data)).toEqual({ kind: "component", data });
});
