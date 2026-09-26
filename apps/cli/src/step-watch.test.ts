import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createMapServer } from "@mapward/abstract-server";
import { createPorts } from "./ports.ts";

/**
 * Вотчер шага на настоящем диске — решение 0043: `fs.watch` терминала и сверка глобов в его порту
 * без заглушек. Пакет сервера этого не проверит: у него нет файловой системы.
 */

let root = "";
const slash = (path: string) => path.replaceAll("\\", "/");

beforeAll(async () => {
  root = slash(await mkdtemp(join(tmpdir(), "mapward-watch-")));
  const files: Record<string, string> = {
    "map/_index.json": JSON.stringify({ name: "Корень" }),
    "map/_metrics/tree/config.json": JSON.stringify({
      label: "Дерево",
      refresh: "on-display",
      collectorsStaleTime: 0,
      collectors: [
        {
          kind: "read-dir",
          basePath: `${root}/src`,
          include: ["**/*.ts"],
          watch: { debounce: 50 },
        },
      ],
      display: { kind: "tree" },
    }),
    "src/a.ts": "export {};",
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const names = (data: unknown): string[] =>
  ((data as { children?: { name: string }[] } | undefined)?.children ?? []).map(
    (node) => node.name,
  );

test("новый файл под watch пересобирает дерево, файл мимо глобов — нет", async () => {
  const server = createMapServer(createPorts());
  const ref = { mapPath: `${root}/map`, basePath: root, name: "test" };
  const address = "mapward://_metrics/tree";
  let latest: string[] = [];
  let updates = 0;
  let resolveNext: (() => void) | undefined;

  const subscription = server.watchMetrics(ref).subscribe((snapshot) => {
    const value = snapshot[address];
    if (!value?.collected || value.busy) return;
    latest = names(value.data);
    updates += 1;
    resolveNext?.();
  });
  const next = () => new Promise<void>((resolve) => (resolveNext = resolve));
  const settle = async (check: () => boolean) => {
    for (let attempt = 0; attempt < 50 && !check(); attempt++) {
      // oxlint-disable-next-line no-await-in-loop
      await Promise.race([next(), new Promise((resolve) => setTimeout(resolve, 100))]);
    }
  };

  await settle(() => latest.includes("a.ts"));
  expect(latest).toEqual(["a.ts"]);

  await writeFile(join(root, "src/b.ts"), "export {};");
  await settle(() => latest.includes("b.ts"));
  expect(latest).toEqual(["a.ts", "b.ts"]);

  const before = updates;
  await writeFile(join(root, "src/notes.md"), "# мимо");
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(updates).toBe(before);

  subscription.unsubscribe();
}, 15_000);
