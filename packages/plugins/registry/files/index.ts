import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { createVfs, definePlugin, every, isReady, settle, type Vfs } from "@mapward/plugin";
import { defer, Observable } from "rxjs";
import { Type } from "typebox";
import { markGit } from "./git-mark.ts";
import { liveTree } from "./live-tree.ts";
import { lettersOf, repoOf, type Repo } from "./repo.ts";
import { readTree, slash, type Node, type TreeSpec } from "./tree.ts";

/**
 * Файлы папки. Дерево держится в памяти процесса и одно на всех подписчиков с теми же
 * параметрами: десять открытых пакетов с одной папкой — одно дерево. Читает его `createVfs`
 * точечно: правка файла перечитывает его и папки над ним, а не всё дерево. С `git: true` узлы
 * несут пометки git, и следит дерево ещё и за индексом и `HEAD` git — через `stat$` того же
 * `createVfs`: пометка протухает не по часам, а по индексу. Открыть файл — не его дело: ссылки открывает плагин `navigation`.
 *
 * Это код проекта: правь под себя.
 */

type Tree = { children: Node[] };

/** `git checkout` пишет индекс целой серией: ждём тишины. */
const QUIET_MS = 200;

type Shared = {
  last?: Tree;
  listeners: Set<(tree: Tree) => void>;
  stop: () => void;
};

const trees = new Map<string, Shared>();

/** Файлы потоками — одни на папку, сколько бы деревьев на неё ни смотрело. */
const disks = new Map<string, Vfs>();
const vfsOf = (root: string): Vfs => {
  const known = disks.get(root);
  if (known) return known;
  const created = createVfs(root);
  disks.set(root, created);
  return created;
};

/**
 * Записал ли git что-то своё: индекс меняется на каждый `add`, `commit` и правку через git, HEAD —
 * на смене ветки. Содержимое не нужно, нужен сам факт записи — поэтому `stat$`, а не чтение:
 * размер и время изменения, одинаковые дальше не уходят. Первое значение тоже зовёт обратно:
 * `stat` читается не сразу, и коммит, успевший между статусом и ним, иначе потерялся бы.
 */
function watchGit(gitDir: string, onChange: () => void): () => void {
  const vfs = vfsOf(gitDir);
  const subscription = every([vfs.stat$(`${gitDir}/index`), vfs.stat$(`${gitDir}/HEAD`)]).subscribe(
    (stats) => {
      if (isReady(stats)) onChange();
    },
  );
  return () => subscription.unsubscribe();
}

function shared(spec: TreeSpec): Shared {
  const key = JSON.stringify(spec);
  const known = trees.get(key);
  if (known) return known;

  const root = slash(spec.path);
  let repo: Promise<Repo | undefined> | undefined;
  let raw: Node[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopGit: (() => void) | undefined;
  let stopped = false;

  const entry: Shared = { listeners: new Set(), stop: () => {} };

  const publish = async () => {
    if (!raw) return;
    let children = raw;
    if (spec.git) {
      const found = await (repo ??= repoOf(root));
      if (found) {
        // Упавший git дерево не роняет: узлы проходят без пометок — не сошлась пометка, а не данные.
        const letterOf = await lettersOf(found).catch(() => undefined);
        if (letterOf) children = (markGit({ children: raw }, letterOf) as Tree).children;
        if (!stopGit && !stopped) stopGit = watchGit(found.gitDir, later);
      }
    }
    if (stopped) return;
    // Git перечитан, а пометки те же — подписчикам нечего слать.
    if (entry.last && JSON.stringify(entry.last.children) === JSON.stringify(children)) return;
    entry.last = { children };
    for (const listener of entry.listeners) listener(entry.last);
  };

  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void publish(), QUIET_MS);
  };

  const subscription = liveTree(vfsOf(root), spec)
    .pipe(settle())
    .subscribe((nodes) => {
      raw = nodes;
      void publish();
    });
  entry.stop = () => {
    stopped = true;
    clearTimeout(timer);
    subscription.unsubscribe();
    stopGit?.();
  };

  trees.set(key, entry);
  return entry;
}

const flatten = (nodes: Node[]): string[] =>
  nodes.flatMap((node) => (node.isDir ? flatten(node.children) : [node.link]));

const count = (nodes: Node[]): { files: number; dirs: number } =>
  nodes.reduce(
    (sum, node) => {
      if (!node.isDir) return { ...sum, files: sum.files + 1 };
      const inner = count(node.children);
      return { files: sum.files + inner.files, dirs: sum.dirs + 1 + inner.dirs };
    },
    { files: 0, dirs: 0 },
  );

const TREE = Type.Object({
  path: Type.String({ description: "папка, абсолютный путь" }),
  include: Type.Optional(
    Type.Array(Type.String(), { description: "глобы от path: показывать только подходящие файлы" }),
  ),
  exclude: Type.Optional(
    Type.Array(Type.String(), { description: "глобы от path: чего не показывать" }),
  ),
  content: Type.Optional(Type.Boolean({ description: "положить текст файла в узел полем text" })),
  git: Type.Optional(
    Type.Boolean({ description: "пометки git на узлах: M A D U C, папка — сильнейшая внутри" }),
  ),
});

export default definePlugin({
  description: "Файлы папки: дерево потоком (с пометками git по желанию) и сводка для агента",
  methods: {
    tree: {
      description:
        "Дерево папки { children: [{ label, link, isDir, children, text?, git? }] }; новое значение — после каждого изменения файлов, а с git — и индекса",
      params: TREE,
      run: (args) =>
        new Observable<Tree>((subscriber) => {
          const entry = shared(args);
          const listener = (tree: Tree) => subscriber.next(tree);
          entry.listeners.add(listener);
          if (entry.last) subscriber.next(entry.last);
          return () => {
            entry.listeners.delete(listener);
            if (entry.listeners.size > 0) return;
            entry.stop();
            trees.delete(JSON.stringify(args));
          };
        }),
    },
    summary: {
      description: "Сколько в папке файлов и папок и какие файлы самые большие — вид для агента",
      params: TREE,
      run: (args) =>
        defer(async () => {
          const tree = trees.get(JSON.stringify(args))?.last?.children ?? (await readTree(args));
          const sizes = await Promise.all(
            flatten(tree).map(async (file) => ({
              file,
              size: (await stat(file).catch(() => undefined))?.size ?? 0,
            })),
          );
          return {
            ...count(tree),
            largest: sizes
              .toSorted((a, b) => b.size - a.size)
              .slice(0, 5)
              .map((entry) => ({
                file: relative(args.path, entry.file).replaceAll("\\", "/"),
                bytes: entry.size,
              })),
          };
        }),
    },
  },
});
