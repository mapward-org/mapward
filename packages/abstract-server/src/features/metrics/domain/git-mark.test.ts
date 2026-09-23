import { expect, test } from "vitest";
import type { GitLetter } from "@mapward/core";
import { fileLinks, markGit } from "./git-mark.ts";

const marks: Record<string, GitLetter> = {
  "/repo/src/changed.ts": "M",
  "/repo/src/nested/gone.ts": "D",
  "/repo/README.md": "U",
};

const letterOf = (path: string) => marks[path];

test("пометки садятся на файлы дерева, папка берёт сильнейшую у потомков", () => {
  const data = {
    children: [
      {
        label: "src",
        link: "/repo/src",
        isDir: true,
        children: [
          { label: "changed.ts", link: "/repo/src/changed.ts", isDir: false, children: [] },
          {
            label: "nested",
            link: "/repo/src/nested",
            isDir: true,
            children: [
              { label: "gone.ts", link: "/repo/src/nested/gone.ts", isDir: false, children: [] },
            ],
          },
        ],
      },
      { label: "README.md", link: "/repo/README.md", isDir: false, children: [] },
    ],
  };

  type Marked = { git?: string; children?: Marked[] };
  const marked = markGit(data, letterOf) as Marked;
  const src = marked.children?.[0];

  expect(src?.children?.[0]?.git).toBe("M");
  // Пропажа заметнее правки: папка с правленым и удалённым внутри говорит про удалённый.
  expect(src?.git).toBe("D");
  expect(marked.children?.[1]?.git).toBe("U");
  // Верхний уровень — обёртка формы, а не узел: пометке там висеть не на чем.
  expect(marked.git).toBeUndefined();
});

test("список и одиночная ссылка размечаются тем же шагом", () => {
  const list = markGit({ items: [{ label: "правленый", link: "/repo/src/changed.ts" }] }, letterOf);
  expect((list as { items: { git?: string }[] }).items[0]?.git).toBe("M");

  // У дисплея `link` узел и есть верхний уровень — отличает его собственная ссылка.
  const one = markGit({ label: "readme", link: "/repo/README.md" }, letterOf);
  expect((one as { git?: string }).git).toBe("U");
});

test("узлы без файловой ссылки не трогаются", () => {
  const data = {
    nodes: [
      { label: "объект", link: "mapward://packages/core" },
      { label: "дока", link: "https://example.com/doc" },
      { label: "без ссылки" },
    ],
  };

  const marked = markGit(data, () => "M" as GitLetter) as { nodes: { git?: string }[] };
  expect(marked.nodes.every((node) => node.git === undefined)).toBe(true);
});

test("прошлая пометка снимается, когда её больше нет", () => {
  const data = { children: [{ label: "чистый", link: "/repo/src/clean.ts", git: "M" }] };
  const marked = markGit(data, letterOf) as { children: { git?: string }[] };
  expect(marked.children[0]?.git).toBeUndefined();
});

test("пути собираются только у файловых ссылок", () => {
  const data = {
    children: [
      { link: "/repo/src", isDir: true, children: [{ link: "/repo/src/changed.ts" }] },
      { link: "mapward://packages/core" },
    ],
  };

  expect(fileLinks(data)).toEqual(["/repo/src", "/repo/src/changed.ts"]);
});
