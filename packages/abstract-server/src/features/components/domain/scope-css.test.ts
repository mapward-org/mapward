import { expect, test } from "vitest";
import { scopeCss, scopePrelude } from "./scope-css.ts";

const TAILWIND = `/*! tailwindcss v4 | MIT License */
@layer properties;
@layer theme, base, components, utilities;
@layer theme {
  :root, :host {
    --spacing: 0.25rem;
  }
}
@layer utilities {
  .p-2 {
    padding: calc(var(--spacing) * 2);
  }
  @media (hover: hover) {
    .hover\\:underline:hover {
      text-decoration-line: underline;
    }
  }
}
@property --tw-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
@layer properties {
  @supports (-webkit-hyphens: none) {
    *, ::before, ::after { --tw-shadow: 0 0 #0000; }
  }
}
.own { content: "}"; }
`;

test("утилиты ограничены меткой компонента внутри своего слоя", () => {
  const css = scopeCss(TAILWIND, "c1");
  const scope = scopePrelude("c1");
  expect(scope).toBe(
    '@scope ([data-mw-component="c1"]) to (:scope [data-mw-map], :scope [data-mw-component])',
  );
  // Слой остаётся слоем — порядок с картой не меняется, граница внутри.
  expect(css).toMatch(/@layer utilities \{\s*@scope \(\[data-mw-component="c1"\]\)[^{]*\{\s*\.p-2/);
  expect(css).toContain("text-decoration-line: underline");
});

test("тема, начальные значения, @property и @keyframes остаются общими", () => {
  const css = scopeCss(TAILWIND, "c1");
  expect(css).toMatch(/^[^\n]*\n?@layer properties;/m);
  expect(css).toMatch(/@layer theme \{\s*:root, :host/);
  expect(css).toMatch(/(^|\n)@property --tw-shadow \{/);
  expect(css).toMatch(/(^|\n)@keyframes pulse \{/);
  expect(css).toMatch(/@layer properties \{\s*@supports/);
  // Ни одно из них не попало под границу.
  for (const global of ["@layer theme", "@property", "@keyframes", "@layer properties {"]) {
    const before = css.slice(0, css.indexOf(global));
    const opened = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(opened, global).toBe(0);
  }
});

test("своё css компонента без слоя — тоже под границей; скобка в строке не ломает разбор", () => {
  const css = scopeCss(TAILWIND, "c1");
  expect(css).toMatch(
    /@scope \(\[data-mw-component="c1"\]\)[^{]*\{\s*\.own \{ content: "\}"; \}\s*\}/,
  );
});
