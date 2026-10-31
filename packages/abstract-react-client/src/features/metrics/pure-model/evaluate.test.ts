import { expect, test } from "vitest";
import { evaluateModule } from "./evaluate.ts";

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
