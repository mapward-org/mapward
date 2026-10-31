import { execFile } from "node:child_process";
import type { GitLetter } from "@mapward/plugin";
import { foldersOf, parsePorcelain, strongest } from "./git.ts";
import { slash } from "./tree.ts";

/**
 * Git для дерева — то, что раньше было трансформом `git-status` (решение 0023): корень
 * репозитория папки, статус одной командой и буква для пути.
 */

export type Repo = { root: string; gitDir: string };

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/**
 * Корень и настоящий gitdir одной командой: у сабмодуля и у worktree `.git` — файл, и следить за
 * ним бесполезно. Папка вне git, git не установлен — `undefined`: «пометок не будет», не поломка.
 */
export async function repoOf(folder: string): Promise<Repo | undefined> {
  try {
    const [root, gitDir] = (
      await git(["rev-parse", "--show-toplevel", "--absolute-git-dir"], folder)
    )
      .trim()
      .split("\n");
    return root && gitDir ? { root: slash(root), gitDir: slash(gitDir) } : undefined;
  } catch {
    return undefined;
  }
}

const inside = (root: string, path: string): boolean =>
  path.toLowerCase().startsWith(`${root.toLowerCase()}/`);

/** Буква для абсолютного пути по статусу репозитория; папка отвечает сильнейшим внутри. */
export async function lettersOf(repo: Repo): Promise<(path: string) => GitLetter | undefined> {
  const exact = parsePorcelain(await git(["status", "--porcelain", "-z", "-uall"], repo.root));
  const lower = new Map([...exact].map(([path, letter]) => [path.toLowerCase(), letter]));
  const folders = foldersOf(exact);
  return (path) => {
    const full = slash(path);
    if (!inside(repo.root, full)) return undefined;
    const relative = full.slice(repo.root.length + 1);
    // Точное совпадение сперва: где регистр значим, README.md и readme.md — разные файлы.
    const own = exact.get(relative) ?? lower.get(relative.toLowerCase());
    if (own) return own;
    const inFolder = folders.get(relative);
    return inFolder ? strongest(inFolder) : undefined;
  };
}
