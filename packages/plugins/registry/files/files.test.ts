import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { plugin } from "../harness.ts";
import files from "./index.ts";

/**
 * `files.tree` на настоящем диске и настоящем git: временный репозиторий, правка, новый файл и
 * коммит — пометки ставятся и снимаются вотчером индекса, а не по часам.
 */

let dir = "";
const slash = (path: string) => path.replaceAll("\\", "/");
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });

type Node = { label: string; isDir: boolean; children: Node[]; text?: string; git?: string };
type Tree = { children: Node[] };

beforeAll(async () => {
  dir = slash(await mkdtemp(join(tmpdir(), "mapward-files-")));
  await mkdir(join(dir, "src/nested"), { recursive: true });
  await mkdir(join(dir, "node_modules/x"), { recursive: true });
  await writeFile(join(dir, "src/kept.ts"), "export {};", "utf8");
  await writeFile(join(dir, "src/nested/changed.ts"), "раз", "utf8");
  await writeFile(join(dir, "README.md"), "# readme", "utf8");
  await writeFile(join(dir, "node_modules/x/index.js"), "", "utf8");
  git("init", "-q");
  git("add", "src", "README.md");
  git("commit", "-q", "-m", "init");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const find = (nodes: Node[], ...path: string[]): Node | undefined => {
  const [head, ...rest] = path;
  const node = nodes.find((one) => one.label === head);
  return rest.length === 0 ? node : find(node?.children ?? [], ...rest);
};

test("files.tree: folders first, include and exclude by globs, text with content", async () => {
  const { call } = plugin(dir, files);
  // Поток живёт, пока подписан: первое значение — и хватит.
  const tree = await new Promise<Tree>((resolve) => {
    const { stream } = plugin(dir, files);
    const { cancel } = stream(
      "tree",
      { path: dir, include: ["**/*.ts"], exclude: ["**/node_modules/**"], content: true },
      {
        next: (value) => {
          cancel();
          resolve(value as Tree);
        },
        error: () => {},
        complete: () => {},
      },
    );
  });

  // С include пустые ветки отпадают: README не .ts, node_modules исключён.
  expect(tree.children.map((node) => node.label)).toEqual(["src"]);
  expect(find(tree.children, "src")?.children.map((node) => node.label)).toEqual([
    "nested",
    "kept.ts",
  ]);
  expect(find(tree.children, "src", "nested", "changed.ts")?.text).toBe("раз");

  const summary = await call("summary", { path: dir, exclude: ["**/node_modules/**"] });
  expect(summary.values[0]).toMatchObject({ files: 3, dirs: 2 });
});

test("files.tree with git: marks on files, the strongest on a folder, gone after a commit", async () => {
  await writeFile(join(dir, "src/nested/changed.ts"), "два", "utf8");
  await writeFile(join(dir, "src/new.ts"), "export {};", "utf8");

  const { stream } = plugin(dir, files);
  const trees: Tree[] = [];
  let staged = false;
  await new Promise<void>((resolve, reject) => {
    const { cancel } = stream(
      "tree",
      { path: dir, exclude: ["**/node_modules/**"], git: true },
      {
        next: (value) => {
          const tree = value as Tree;
          trees.push(tree);
          // Первое значение — с пометками; дальше коммит, и пометки должен снять вотчер индекса.
          if (trees.length === 1) {
            git("add", "-A");
            git("commit", "-q", "-m", "next");
          }
          const clean = trees.length > 1 && find(tree.children, "src")?.git === undefined;
          if (clean && !staged) {
            // Пометки сняты. Дальше файл правится и добавляется в индекс: список папки от этого
            // не меняется, и пометку приносит только stat индекса — значит, за ним следят и после
            // первого значения.
            staged = true;
            void writeFile(join(dir, "src/kept.ts"), "export const x = 1;", "utf8").then(() =>
              git("add", "src/kept.ts"),
            );
          }
          if (staged && find(tree.children, "src", "kept.ts")?.git === "M") {
            cancel();
            resolve();
          }
        },
        error: (error) => reject(new Error(error)),
        complete: () => {},
      },
    );
  });

  const [marked] = trees;
  expect(find(marked!.children, "src", "nested", "changed.ts")?.git).toBe("M");
  expect(find(marked!.children, "src", "new.ts")?.git).toBe("U");
  expect(find(marked!.children, "src", "kept.ts")?.git).toBeUndefined();
  // Папка отвечает сильнейшим внутри: правка заметнее неотслеживаемого.
  expect(find(marked!.children, "src")?.git).toBe("M");
  expect(find(marked!.children, "README.md")?.git).toBeUndefined();
  // После коммита пометок нет нигде.
  const committed = trees.find((tree) => find(tree.children, "src")?.git === undefined);
  expect(find(committed!.children, "src", "new.ts")?.git).toBeUndefined();
}, 20_000);
