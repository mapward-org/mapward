import type { Layout, LayoutVariant } from "@mapward/core";
import { layoutVariants } from "@mapward/core";

/**
 * Раскладка — это css (решение 0033): каждый вариант становится правилом, вариант под ключом —
 * правилом внутри `@container`. Какой из них действует, решает браузер по ширине контейнера,
 * а не код: порядок ключей — порядок правил, побеждает последний подошедший.
 */
export type GridPlan = {
  /** Правила сетки под классом `scope`; кладутся тегом `<style>` рядом с ней. */
  css: string;
  /**
   * Метрики, названные хотя бы в одном варианте. Остальные не показываются и не собираются
   * (решение 0029); в варианте, где метрики нет, её клетка скрыта.
   */
  placed: Set<string>;
};

/** Клетка сетки несёт ключ метрики этим атрибутом — по нему её находят правила. */
export const cellAttribute = "data-metric";

export function planGrid(
  layout: Layout | undefined,
  keys: string[],
  scope: string,
): GridPlan | undefined {
  const variants = layoutVariants(layout);
  if (variants.length === 0) return undefined;

  const named = new Set(variants.flatMap(({ variant }) => areaNames(variant)));
  const placed = new Set(keys.filter((key) => named.has(key)));

  const css = variants
    .map(({ query, variant }) => {
      const rules = variantRules(scope, variant, placed);
      return query === undefined ? rules : `@container (${query}) {\n${rules}\n}`;
    })
    .join("\n");

  return { css, placed };
}

/**
 * Таб одной метрики: раскладывать нечего, и раскладка тут не нужна — нужен один трек на всю
 * ширину и на всю высоту. Метрика в табе занимает его целиком, ради этого таб и открывали
 * (решение 0026).
 */
export function soloGrid(key: string) {
  return {
    columns: "minmax(0, 1fr)",
    rows: "minmax(0, 1fr)",
    placed: new Set([key]),
  };
}

function areaNames(variant: LayoutVariant): string[] {
  return variant.areas.flat().filter((name) => name !== ".");
}

function variantRules(scope: string, variant: LayoutVariant, placed: Set<string>): string {
  const width = Math.max(...variant.areas.map((row) => row.length), 1);
  const here = new Set(areaNames(variant));

  const grid = [
    `grid-template-areas: ${variant.areas.map((row) => `"${row.join(" ")}"`).join(" ")}`,
    `grid-template-columns: repeat(${width}, minmax(0, 1fr))`,
    // `style` раскладки идёт после своих свойств и перебивает их: это css, как он написан.
    ...Object.entries(variant.style ?? {}).map(([name, value]) => `${kebab(name)}: ${value}`),
  ];

  const cells = [...placed].map((key) => {
    const cell = `.${scope} > [${cellAttribute}="${escapeAttribute(key)}"]`;
    // Область называется только там, где она объявлена: имя, которого в сетке нет, кладёт
    // клетку по несуществующей линии, и она встаёт куда придётся.
    return here.has(key)
      ? `${cell} { grid-area: ${key}; display: flex; }`
      : `${cell} { display: none; }`;
  });

  return [`.${scope} { ${grid.join("; ")}; }`, ...cells].join("\n");
}

/** `gridTemplateRows` из раскладки — это `grid-template-rows` в css. */
function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function escapeAttribute(value: string): string {
  return value.replace(/["\\]/g, (char) => `\\${char}`);
}
