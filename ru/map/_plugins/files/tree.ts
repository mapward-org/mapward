import { readdir, readFile } from "node:fs/promises";
import { excluded, matchesAny } from "@mapward/plugin";
import type { GitLetter } from "@mapward/plugin";

/**
 * Дерево папки — то, что раньше было коллектором `read-dir`. Узел — та же форма, что рисует вид
 * `tree`: `link` — путь файла (по нему строка открывается), `label` — имя, `text` — содержимое с
 * `content: true`, `git` — пометка с `git: true`.
 */
export type Node = {
  name: string;
  label: string;
  link: string;
  isDir: boolean;
  children: Node[];
  /** Только с `content: true` — решение 0010: статус живёт внутри файла, а не в имени. */
  text?: string;
  git?: GitLetter;
};

export type TreeSpec = {
  path: string;
  include?: string[];
  exclude?: string[];
  content?: boolean;
  git?: boolean;
};

/** Внутрь `.git` не ходим никогда: это не файлы проекта, а его история. */
const NEVER = ".git";

export const slash = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");

/**
 * Глобы сверяются с путём от `path`, поэтому конфиг говорит один шаблон и значит его на любой
 * платформе. С `include` папка, в которой ничего подходящего нет, не показывается: фильтр и нужен,
 * чтобы не рисовать пустые леса вокруг двух файлов.
 */
export async function readTree(spec: TreeSpec): Promise<Node[]> {
  const walk = async (dir: string, prefix: string): Promise<Node[]> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const nodes: Node[] = [];

    for (const entry of entries) {
      if (entry.name === NEVER) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded(relative, spec.exclude)) continue;
      const link = `${dir}/${entry.name}`;

      if (entry.isDirectory()) {
        // Вглубь по порядку нарочно: дерево читается в том порядке, в каком его покажут.
        // oxlint-disable-next-line no-await-in-loop
        const children = await walk(link, relative);
        if (spec.include?.length && children.length === 0) continue;
        nodes.push({ name: entry.name, label: entry.name, link, isDir: true, children });
        continue;
      }

      if (!matchesAny(relative, spec.include)) continue;
      // oxlint-disable-next-line no-await-in-loop
      const text = spec.content ? await readFile(link, "utf8").catch(() => undefined) : undefined;
      nodes.push({
        name: entry.name,
        label: entry.name,
        link,
        isDir: false,
        children: [],
        ...(text === undefined ? {} : { text }),
      });
    }

    // Порядок проводника: папки сверху, дальше по имени без регистра.
    return nodes.toSorted((a, b) =>
      a.isDir === b.isDir
        ? a.name.localeCompare(b.name, "ru", { sensitivity: "base" })
        : a.isDir
          ? -1
          : 1,
    );
  };

  return walk(slash(spec.path), "");
}
