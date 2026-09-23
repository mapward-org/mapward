import { expect, test } from "vitest";
import type { ServerPorts } from "../../../../ports/index.ts";
import { appendReply, deleteDirective } from "./directives.ts";

/** Диск в памяти: удаление проверяется тем же способом, что и чтение карты — решение 0014. */
function fakePorts(tree: Record<string, string>): ServerPorts {
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
  return { files } as unknown as ServerPorts;
}

const OBJECT = "/map/packages/core";
const DIRECTIVE = "2026-09-20-1737-кнопка.md";

test("удаляет директиву вместе с состоянием её прогонов", async () => {
  const tree = {
    [`${OBJECT}/_directives/${DIRECTIVE}`]: "\n## \n\n",
    [`${OBJECT}/_directives.state/2026-09-20-1737-кнопка.state.json`]: "{}",
    [`${OBJECT}/_directives/другая.md`]: "текст",
  };

  const result = await deleteDirective(fakePorts(tree), {
    objectPath: OBJECT,
    directive: DIRECTIVE,
  });

  expect(result).toEqual({ deleted: true });
  expect(Object.keys(tree)).toEqual([`${OBJECT}/_directives/другая.md`]);
});

test("директивы нет у объекта — удалять нечего", async () => {
  const tree = { [`${OBJECT}/_directives/своя.md`]: "текст" };

  const result = await deleteDirective(fakePorts(tree), {
    objectPath: OBJECT,
    directive: "от-прототипа.md",
  });

  expect(result).toEqual({ deleted: false });
  expect(Object.keys(tree)).toHaveLength(1);
});

test("именем директивы не выйти из папки объекта", async () => {
  const tree = { "/map/_index.json": "{}" };

  await expect(
    deleteDirective(fakePorts(tree), { objectPath: OBJECT, directive: "../../_index.json" }),
  ).rejects.toThrow("Не имя директивы");
});

test("реплика дописывается в конец и не трогает то, что выше", async () => {
  const path = `${OBJECT}/_directives/${DIRECTIVE}`;
  const cases: [string, string][] = [
    ["", "> [AI] да\n"],
    ["ответ", "ответ\n\n> [AI] да\n"],
    ["ответ\n", "ответ\n\n> [AI] да\n"],
    ["ответ\n\n", "ответ\n\n> [AI] да\n"],
  ];
  for (const [before, after] of cases) {
    const tree: Record<string, string> = { [path]: before };
    // oxlint-disable-next-line no-await-in-loop
    await appendReply(fakePorts(tree), { directivePath: path, reply: "> [AI] да\n\n" });
    expect(tree[path]).toBe(after);
  }
});
