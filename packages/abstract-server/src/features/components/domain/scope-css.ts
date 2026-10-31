/**
 * Граница css компонента — решение 0048. Правила компонента действуют только на его территории:
 * внутри элементов с меткой `data-mw-component` этого компонента (клетка и слой всплывающих окон)
 * и не глубже кусков карты, которые компонент вставил в себя (`data-mw-map`), и вложенных чужих
 * компонентов — у тех своя метка.
 *
 * Не заворачивается то, что на территорию не делится: переменные темы (`@layer theme` — те же
 * значения, что у карты), начальные значения переменных tailwind (`@layer properties`),
 * `@property`, `@keyframes`, `@font-face`, `@import`, `@charset` и объявления порядка слоёв.
 */

/** Атрибут метки компонента — ставит карта на клетку и на слой всплывающих окон. */
export const COMPONENT_MARK = "data-mw-component";
/** Атрибут куска карты внутри компонента: карточка объекта на холсте. */
export const MAP_MARK = "data-mw-map";

const GLOBAL_LAYERS = new Set(["theme", "properties"]);
const GLOBAL_AT_RULES = new Set([
  "property",
  "keyframes",
  "-webkit-keyframes",
  "font-face",
  "import",
  "charset",
  "namespace",
  "font-feature-values",
  "counter-style",
  "page",
]);

type Chunk = { prelude: string; body?: string };

/** Css на верхнем уровне — по правилам: `prelude { body }` или `prelude;`. */
function chunks(css: string): Chunk[] {
  const out: Chunk[] = [];
  let start = 0;
  let depth = 0;
  let open = -1;
  for (let at = 0; at < css.length; at++) {
    const char = css[at];
    if (char === "/" && css[at + 1] === "*") {
      const end = css.indexOf("*/", at + 2);
      at = end === -1 ? css.length : end + 1;
    } else if (char === '"' || char === "'") {
      at = skipString(css, at, char);
    } else if (char === "{") {
      if (depth === 0) open = at;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        out.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, at) });
        start = at + 1;
      }
    } else if (char === ";" && depth === 0) {
      out.push({ prelude: css.slice(start, at).trim() });
      start = at + 1;
    }
  }
  const rest = css.slice(start).trim();
  if (rest) out.push({ prelude: rest });
  return out;
}

function skipString(css: string, from: number, quote: string): number {
  for (let at = from + 1; at < css.length; at++) {
    if (css[at] === "\\") at++;
    else if (css[at] === quote) return at;
  }
  return css.length;
}

/** Имя at-правила без `@`, в нижнем регистре; у обычного правила — `undefined`. */
function atName(prelude: string): string | undefined {
  const text = prelude.replace(/^(\s|\/\*[\s\S]*?\*\/)*/, "");
  const match = /^@([\w-]+)/.exec(text);
  return match?.[1]?.toLowerCase();
}

function isGlobal(chunk: Chunk): boolean {
  const name = atName(chunk.prelude);
  if (name === undefined) return false;
  if (GLOBAL_AT_RULES.has(name)) return true;
  if (name !== "layer") return false;
  // `@layer a, b;` — порядок слоёв; `@layer theme { … }` — тема.
  if (chunk.body === undefined) return true;
  const layer = chunk.prelude.replace(/^[^@]*@layer/i, "").trim();
  return GLOBAL_LAYERS.has(layer);
}

/** Начало `@scope` для метки компонента. */
export function scopePrelude(mark: string): string {
  const root = `[${COMPONENT_MARK}="${mark}"]`;
  return `@scope (${root}) to (:scope [${MAP_MARK}], :scope [${COMPONENT_MARK}])`;
}

/**
 * Css компонента, ограниченный его территорией. Слой `utilities` остаётся слоем: граница ложится
 * внутрь него, и порядок слоёв с картой не меняется.
 */
export function scopeCss(css: string, mark: string): string {
  const scope = scopePrelude(mark);
  const wrap = (text: string) => `${scope} {\n${text}\n}`;
  const out: string[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (pending.length) out.push(wrap(pending.join("\n")));
    pending = [];
  };
  for (const chunk of chunks(css)) {
    const text =
      chunk.body === undefined ? `${chunk.prelude};` : `${chunk.prelude} {${chunk.body}}`;
    if (isGlobal(chunk)) {
      flush();
      out.push(text);
    } else if (atName(chunk.prelude) === "layer" && chunk.body !== undefined) {
      flush();
      out.push(`${chunk.prelude} {\n${wrap(chunk.body)}\n}`);
    } else {
      pending.push(text);
    }
  }
  flush();
  return out.join("\n");
}
