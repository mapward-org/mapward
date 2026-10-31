import { every, excluded, follow, mapReady, matchesAny, type Vfs } from "@mapward/plugin";
import { slash, type Node, type TreeSpec } from "./tree.ts";

/** Поток дерева: `PENDING`, пока что-то под ним читается, дальше — готовые узлы. */
type Stream<T> = ReturnType<typeof every<T>>;

/** Внутрь `.git` не ходим никогда: это не файлы проекта, а его история. */
const NEVER = ".git";

/**
 * Дерево папки потоком поверх `createVfs`: каждая папка — свой `list$`, файл с `content` — свой
 * `text$`. Правка файла перечитывает его и папки над ним, а не всё дерево; то, что дерево не
 * показывает (исключённое, `.git`), не читается вовсе. Форма и порядок — те же, что у `readTree`.
 */
export function liveTree(vfs: Vfs, spec: TreeSpec): Stream<Node> {
  const walk = (dir: string, prefix: string): Stream<Node> =>
    vfs.list$(dir).pipe(
      follow((entries) => {
        const fixed: Node[] = [];
        const live: Stream<Node>[] = [];
        for (const entry of entries) {
          if (entry.name === NEVER) continue;
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (excluded(relative, spec.exclude)) continue;
          const link = `${dir}/${entry.name}`;
          const base = { name: entry.name, label: entry.name, link };

          if (entry.isDirectory) {
            live.push(
              walk(link, relative).pipe(
                // С `include` папка, в которой ничего подходящего нет, не показывается.
                mapReady((children) =>
                  spec.include?.length && children.length === 0
                    ? []
                    : [{ ...base, isDir: true, children }],
                ),
              ),
            );
            continue;
          }

          if (!matchesAny(relative, spec.include)) continue;
          if (!spec.content) {
            fixed.push({ ...base, isDir: false, children: [] });
            continue;
          }
          live.push(
            vfs
              .text$(link)
              .pipe(
                mapReady((text) => [
                  { ...base, isDir: false, children: [], ...(text === undefined ? {} : { text }) },
                ]),
              ),
          );
        }
        return every(live).pipe(mapReady((parts) => sorted([...fixed, ...parts.flat()])));
      }),
    );

  return walk(slash(spec.path), "");
}

/** Порядок проводника: папки сверху, дальше по имени без регистра. */
const sorted = (nodes: Node[]): Node[] =>
  nodes.toSorted((a, b) =>
    a.isDir === b.isDir
      ? a.name.localeCompare(b.name, "ru", { sensitivity: "base" })
      : a.isDir
        ? -1
        : 1,
  );
