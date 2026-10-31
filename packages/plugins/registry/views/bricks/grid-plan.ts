/** Вариант сетки: `areas` — как `grid-template-areas`, `.` — пустая клетка. */
export type GridVariant = {
  areas: string[][];
  /** Css сетки ключами в camelCase: `gridTemplateRows` — это `grid-template-rows`. */
  style?: Record<string, string> | undefined;
};

/** Сетка: один вариант или словарь вариантов по условию `@container`. */
export type GridLayout = GridVariant | Record<string, GridVariant>;

/**
 * Сетка — это css (решение 0033): каждый вариант становится правилом, вариант под ключом —
 * правилом внутри `@container`. Какой из них действует, решает браузер по ширине контейнера,
 * а не код: порядок ключей — порядок правил, побеждает последний подошедший.
 */
export type GridPlan = {
  /** Правила сетки под классом `scope`; кладутся тегом `<style>` рядом с ней. */
  css: string;
  /**
   * Ключи, названные хотя бы в одном варианте. Остальные не ставятся и не монтируются
   * (решение 0029); в варианте, где ключа нет, его клетка скрыта.
   */
  placed: Set<string>;
};

/** Клетка сетки несёт свой ключ этим атрибутом — по нему её находят правила. */
export const cellAttribute = "data-metric";

/** Вариант или словарь — различаются по `areas` на верхнем уровне. */
export function gridVariants(
  layout: GridLayout | undefined,
): { query?: string; variant: GridVariant }[] {
  if (!layout) return [];
  if ("areas" in layout && Array.isArray(layout.areas)) return [{ variant: layout as GridVariant }];
  return Object.entries(layout as Record<string, GridVariant>).map(([query, variant]) => ({
    query,
    variant,
  }));
}

export function planGrid(
  layout: GridLayout | undefined,
  keys: string[],
  scope: string,
): GridPlan | undefined {
  const variants = gridVariants(layout);
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
 * Пропсы кирпича `Grid` — сетка: `variants`, если заданы, иначе один вариант из `areas` и
 * `style`. Без `areas` и без `variants` сетки нет.
 */
export function gridOf(props: {
  areas?: string[][] | undefined;
  style?: Record<string, string> | undefined;
  variants?: Record<string, GridVariant> | undefined;
}): GridLayout | undefined {
  if (props.variants) return props.variants;
  return props.areas ? { areas: props.areas, style: props.style } : undefined;
}

/**
 * Что сетка ставит по местам: ключи, названные в ней, по порядку `children`. Метрика раскладки
 * приходит с подписью и ключом — ставится её `node`; всё прочее ставится как есть.
 */
export function gridCells<N>(
  children: Record<string, N | { node: N; label: string; key: string }>,
  placed: Set<string>,
): [string, N][] {
  return Object.entries(children)
    .filter(([key]) => placed.has(key))
    .map(([key, value]) => [key, isLayoutMetric<N>(value) ? value.node : value]);
}

function isLayoutMetric<N>(value: unknown): value is { node: N; label: string; key: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "node" in value &&
    "label" in value &&
    // React-элемент тоже объект с `key`, но без `node` и `label`.
    !("$$typeof" in value)
  );
}

function areaNames(variant: GridVariant): string[] {
  return variant.areas.flat().filter((name) => name !== ".");
}

function variantRules(scope: string, variant: GridVariant, placed: Set<string>): string {
  const width = Math.max(...variant.areas.map((row) => row.length), 1);
  const here = new Set(areaNames(variant));

  const grid = [
    `grid-template-areas: ${variant.areas.map((row) => `"${row.join(" ")}"`).join(" ")}`,
    `grid-template-columns: repeat(${width}, minmax(0, 1fr))`,
    // `style` сетки идёт после своих свойств и перебивает их: это css, как он написан.
    ...Object.entries(variant.style ?? {}).map(([name, value]) => `${kebab(name)}: ${value}`),
  ];

  const cells = [...placed].map((key) => {
    const cell = `.${scope} > [${cellAttribute}="${escapeAttribute(key)}"]`;
    // Область называется только там, где она объявлена: имя, которого в сетке нет, кладёт
    // клетку по несуществующей линии, и она встаёт куда придётся. Внутри клетки — один трек:
    // метрика занимает её целиком и прокручивается внутри, а не вылезает на соседей.
    return here.has(key)
      ? `${cell} { grid-area: ${key}; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }`
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
