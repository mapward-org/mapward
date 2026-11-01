import { expect, test } from "vitest";
import type { FilesPort } from "../../../../ports/index.ts";
import { appendReply } from "../../domain/thread.ts";
import { DirectiveState } from "../services/directive-state.ts";
import { DeleteDirective } from "./delete-directive.ts";

/** Диск в памяти: удаление проверяется тем же способом, что и чтение карты — решение 0014. */
function fakeFiles(tree: Record<string, string>): FilesPort {
  const files = {
    read: (path: string) => Promise.resolve(tree[path]),
    list: () => Promise.resolve([]),
    write: (path: string, text: string) => {
      tree[path] = text;
      return Promise.resolve();
    },
    remove: (path: string) => {
      delete tree[path];
      return Promise.resolve();
    },
    watch: () => () => undefined,
  };
  return files;
}

const deleteDirective = (files: FilesPort, params: { objectPath: string; directive: string }) =>
  new DeleteDirective(files, files).run(params);

const OBJECT = "/map/packages/core";
const DIRECTIVE = "2026-09-20-1737-кнопка.md";
const PATH = `${OBJECT}/_directives/${DIRECTIVE}`;
const NOW = new Date("2026-10-31T00:00:00Z");

test("удаляет файл директивы, соседние не трогает", async () => {
  const tree = {
    [PATH]: "\n## \n\n",
    [`${OBJECT}/_directives/другая.md`]: "текст",
  };

  const result = await deleteDirective(fakeFiles(tree), {
    objectPath: OBJECT,
    directive: DIRECTIVE,
  });

  expect(result).toEqual({ deleted: true });
  expect(Object.keys(tree)).toEqual([`${OBJECT}/_directives/другая.md`]);
});

test("директивы нет у объекта — удалять нечего", async () => {
  const tree = { [`${OBJECT}/_directives/своя.md`]: "текст" };

  const result = await deleteDirective(fakeFiles(tree), {
    objectPath: OBJECT,
    directive: "от-прототипа.md",
  });

  expect(result).toEqual({ deleted: false });
  expect(Object.keys(tree)).toHaveLength(1);
});

test("именем директивы не выйти из папки объекта", async () => {
  const tree = { "/map/_index.json": "{}" };

  await expect(
    deleteDirective(fakeFiles(tree), { objectPath: OBJECT, directive: "../../_index.json" }),
  ).rejects.toThrow("Не имя директивы");
});

test("реплика дописывается в конец и не трогает то, что выше", () => {
  const cases: [string, string][] = [
    ["", "> [AI] да\n"],
    ["ответ", "ответ\n\n> [AI] да\n"],
    ["ответ\n", "ответ\n\n> [AI] да\n"],
    ["ответ\n\n", "ответ\n\n> [AI] да\n"],
  ];
  for (const [before, after] of cases) {
    expect(appendReply(before, "> [AI] да\n\n")).toBe(after);
  }
});

test("этап пишет состояние во frontmatter, тело остаётся как было", async () => {
  const tree: Record<string, string> = { [PATH]: "## Задача\r\n\r\nтекст" };
  const files = fakeFiles(tree);
  const state = new DirectiveState(files, files);

  await state.started({ directivePath: PATH, stage: "Брейншторм" });
  expect(tree[PATH]).toBe(
    '---\r\nstatus: running\r\nstage: Брейншторм\r\nruns: {"Брейншторм":1}\r\n---\r\n' +
      "## Задача\r\n\r\nтекст",
  );

  await state.finished({
    directivePath: PATH,
    stage: "Брейншторм",
    marksDone: false,
    reply: "> [AI] вопрос",
    now: NOW,
  });
  expect(tree[PATH]).toMatch(/^---\r\nstatus: waiting\r\nstage: Брейншторм\r\n/);
  expect(tree[PATH]).toMatch(/текст\n\n> \[AI\] вопрос\n$/);

  await state.started({ directivePath: PATH, stage: "Выполнить" });
  await state.finished({ directivePath: PATH, stage: "Выполнить", marksDone: true, now: NOW });
  expect(tree[PATH]).toContain('runs: {"Брейншторм":1,"Выполнить":1}');
  expect(tree[PATH]).toContain("status: done");
  expect(tree[PATH]).toContain("closedAt: 2026-10-31T00:00:00.000Z");

  // Выполненную запустили снова — она идёт, отметки о закрытии больше нет.
  await state.started({ directivePath: PATH, stage: "Выполнить" });
  expect(tree[PATH]).toContain("status: running");
  expect(tree[PATH]).not.toContain("closedAt");
});

test("чужие строки frontmatter остаются на месте", async () => {
  const tree: Record<string, string> = { [PATH]: "---\ntags: ui\nstatus: new\n---\nтело\n" };
  const files = fakeFiles(tree);

  await new DirectiveState(files, files).started({ directivePath: PATH, stage: "План" });
  expect(tree[PATH]).toBe(
    '---\ntags: ui\nstatus: running\nstage: План\nruns: {"План":1}\n---\nтело\n',
  );
});
