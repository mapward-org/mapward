/**
 * Кладёт в узлы файлового дерева меню экшонов — поле `actions` строки.
 *
 * Файлу — «переименовать» и «удалить», папке — ещё «новый файл» и «новая папка». В форму
 * каждого экшона уходит путь узла — тот же `link`, по которому строка открывается. Сами экшоны —
 * у прототипа «Система», поэтому строка называет их ключом.
 *
 * На вход приходит выдача read-dir, на выходе { children }: остальное в узлах не трогается.
 */

const rename = (node) => ({ run: "file-rename", inputs: { path: node.link, name: node.label } });
const remove = (node) => ({ run: "file-delete", inputs: { path: node.link } });

function mark(nodes = []) {
  for (const node of nodes) {
    if (!node.link) continue;
    if (node.isDir) {
      node.actions = [
        { run: "file-new", inputs: { folder: node.link } },
        { run: "folder-new", inputs: { folder: node.link } },
        rename(node),
        remove(node),
      ];
      mark(node.children);
    } else {
      node.actions = [rename(node), remove(node)];
    }
  }
  return nodes;
}

const input = await new Promise((resolve) => {
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => resolve(raw));
});

const data = JSON.parse(input || "{}");
const children = mark(Array.isArray(data) ? data : (data.children ?? []));
process.stdout.write(JSON.stringify({ children }));
