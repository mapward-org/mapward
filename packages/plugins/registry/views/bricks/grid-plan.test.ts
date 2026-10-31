import { expect, test } from "vitest";
import { gridCells, gridOf, planGrid } from "./grid-plan.ts";

test("a layout becomes a css rule with named areas and equal columns", () => {
  const plan = planGrid(
    {
      areas: [
        ["files", "tests"],
        ["docs", "."],
      ],
    },
    ["files", "tests", "docs"],
    "g",
  );

  expect(plan?.css).toContain(`.g { grid-template-areas: "files tests" "docs ."`);
  expect(plan?.css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(plan?.css).toContain(
    `.g > [data-metric="files"] { grid-area: files; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }`,
  );
});

/** Решение 0033: `style` раскладки — это css как он написан, и он идёт последним. */
test("the layout style goes into the rule as css properties", () => {
  const plan = planGrid(
    { areas: [["files"]], style: { gridTemplateRows: "fit-content(300px)", height: "100%" } },
    ["files"],
    "g",
  );

  expect(plan?.css).toContain(
    "grid-template-columns: repeat(1, minmax(0, 1fr)); grid-template-rows: fit-content(300px); height: 100%;",
  );
});

/**
 * Решение 0033: ключ словаря — настоящее условие `@container`, порядок ключей — порядок правил.
 * Раньше бралась последняя раскладка, а условие выбрасывалось.
 */
test("keyed variants become container rules in key order", () => {
  const plan = planGrid(
    {
      "min-width: 0px": { areas: [["files"], ["tests"]] },
      "min-width: 600px": { areas: [["files", "tests"]] },
    },
    ["files", "tests"],
    "g",
  );

  const narrow = plan?.css.indexOf("@container (min-width: 0px) {") ?? -1;
  const wide = plan?.css.indexOf("@container (min-width: 600px) {") ?? -1;
  expect(narrow).toBeGreaterThanOrEqual(0);
  expect(wide).toBeGreaterThan(narrow);
});

test("a metric missing from one variant is hidden there and placed in the other", () => {
  const plan = planGrid(
    {
      "min-width: 0px": { areas: [["files"]] },
      "min-width: 600px": { areas: [["files", "tests"]] },
    },
    ["files", "tests"],
    "g",
  );

  const [narrow, wide] = plan?.css.split("@container").slice(1) ?? [];
  expect(narrow).toContain(`.g > [data-metric="tests"] { display: none; }`);
  expect(wide).toContain(
    `.g > [data-metric="tests"] { grid-area: tests; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }`,
  );
  expect([...(plan?.placed ?? [])]).toEqual(["files", "tests"]);
});

/**
 * Решение 0029: неназванная метрика не показывается. Раньше она добавлялась за пределы сетки
 * и вставала неявным рядом.
 */
test("a metric missing from every variant is not placed at all", () => {
  const plan = planGrid({ areas: [["files"]] }, ["files", "forgotten"], "g");

  expect([...(plan?.placed ?? [])]).toEqual(["files"]);
  expect(plan?.css).not.toContain("forgotten");
});

test("no layout means no plan at all", () => {
  expect(planGrid(undefined, ["files"], "g")).toBeUndefined();
});

test("сетка кирпича — варианты, если заданы, иначе areas со style", () => {
  const variants = { "min-width: 0px": { areas: [["files"]] } };
  expect(gridOf({ areas: [["a"]], variants })).toBe(variants);
  expect(gridOf({ areas: [["a"]], style: { gap: "8px" } })).toEqual({
    areas: [["a"]],
    style: { gap: "8px" },
  });
  expect(gridOf({})).toBeUndefined();
});

/** Ставится и монтируется только названное: метрика вне сетки не подписывается вовсе. */
test("в клетки встаёт названное: у метрики раскладки — её node, остальное как есть", () => {
  const cells = gridCells<string>(
    {
      code: { key: "code", label: "Код", node: "<код>" },
      forgotten: { key: "forgotten", label: "Забытая", node: "<забытая>" },
      release: "<кнопка>",
    },
    new Set(["code", "release"]),
  );
  expect(cells).toEqual([
    ["code", "<код>"],
    ["release", "<кнопка>"],
  ]);
});
