/**
 * Превращает файлы требований в дерево для дисплея — решение 0010.
 *
 * На вход приходит выдача read-dir с текстом файлов, на выходе { children }.
 * Статус требования берётся из фронтматтера, заголовок — из первой строки с `#`,
 * иначе имя файла.
 *
 * Статус папки считается по тому, что внутри: всё сделано — сделано, что-то сделано —
 * в работе, ничего — не начинали. Так по свёрнутой ветке видно, стоит ли её открывать.
 *
 * С флагом --todo из дерева убирается сделанное, а пустые ветки отпадают. Статусы папок
 * при этом считаются по полному составу: очередь показывает, что осталось, а папка —
 * как обстоят дела целиком.
 *
 * С флагом --own остаются только требования своего объекта — решение 0011. Свой адрес
 * скрипт берёт из MAPWARD_OBJECT_PATH: это путь от корня карты, то есть адрес без схемы.
 * Требование без `object` считается продуктовым и принадлежит корню карты.
 */

const ORDER = ["implementing", "ready-to-implement", "draft", "implemented", ""];

const MARK = {
  draft: { status: "idle", hint: "черновик" },
  "ready-to-implement": { status: "pending", hint: "готово к реализации" },
  // Свой цвет: «в работе» и «можно брать» — разные вещи, а жёлтый у них был бы один.
  implementing: {
    status: "pending",
    color: "var(--vscode-charts-blue, #4c8eda)",
    hint: "в работе",
  },
  implemented: { status: "success", hint: "сделано" },
};

const UNKNOWN = { status: "idle", hint: "без статуса" };

const FOLDER = {
  done: { status: "success", hint: "всё сделано" },
  going: { status: "pending", color: "var(--vscode-charts-blue, #4c8eda)", hint: "в работе" },
  idle: { status: "idle", hint: "не начинали" },
};

function frontmatter(text = "") {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => /^([\w-]+)\s*:\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map((parsed) => [parsed[1], parsed[2].trim().replace(/^["']|["']$/g, "")]),
  );
}

const title = (text = "", name = "") =>
  /^#\s+(.+)$/m.exec(text.replace(/^---[\s\S]*?---/, ""))?.[1]?.trim() ?? name.replace(/\.md$/, "");

/**
 * Свой адрес: путь объекта от корня карты — это он и есть, без схемы. MAPWARD_OBJECT_PATH
 * должен приходить относительным (0004), но старый рантайм кладёт туда абсолютный путь,
 * поэтому на всякий случай отрезаем корень карты сами — он рядом, в MAPWARD_MAP_PATH.
 */
const slash = (value = "") => value.replaceAll("\\", "/").replace(/\/+$/, "");

function ownAddress() {
  const path = slash(process.env.MAPWARD_OBJECT_PATH);
  const root = slash(process.env.MAPWARD_MAP_PATH);
  const relative = root && path.startsWith(root) ? path.slice(root.length) : path;
  return `mapward://${relative.replace(/^\/+/, "")}`;
}

const own = ownAddress();

/** `object` может быть списком: одно требование бывает про несколько объектов. */
const objectsOf = (meta) =>
  (meta.object ?? "mapward://")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

/** Дерево read-dir в дерево требований: у файлов статус из фронтматтера, у папок — свой. */
function convert(nodes = []) {
  const out = [];

  for (const node of nodes) {
    if (node.isDir) {
      const children = convert(node.children);
      // Пустая после фильтра ветка — чужая: показывать нечего.
      if (children.length > 0) {
        out.push({ label: node.label ?? node.name, link: node.link, isDir: true, children });
      }
      continue;
    }
    const meta = frontmatter(node.text);
    if (mine && !objectsOf(meta).includes(own)) continue;
    const status = meta.status ?? "";
    out.push({
      status,
      label: title(node.text, node.name),
      link: node.link,
      isDir: false,
      children: [],
    });
  }

  return out;
}

const leaves = (nodes) => nodes.flatMap((node) => (node.isDir ? leaves(node.children) : [node]));

function foldStatus(node) {
  const inside = leaves(node.children);
  if (inside.length === 0) return FOLDER.idle;
  const done = inside.filter((leaf) => leaf.status === "implemented").length;
  if (done === inside.length) return FOLDER.done;
  return done === 0 ? FOLDER.idle : FOLDER.going;
}

/** Отметки проставляются до фильтра: очередь режет состав, но не меняет положение дел. */
function mark(nodes) {
  for (const node of nodes) {
    if (node.isDir) {
      Object.assign(node, foldStatus(node));
      mark(node.children);
    } else {
      Object.assign(node, MARK[node.status] ?? UNKNOWN);
    }
  }
}

function todoOnly(nodes) {
  const out = [];
  for (const node of nodes) {
    if (!node.isDir) {
      if (node.hint !== MARK.implemented.hint) out.push(node);
      continue;
    }
    const children = todoOnly(node.children);
    // Пустая ветка в очереди не нужна: в ней нечего делать.
    if (children.length > 0) out.push({ ...node, children });
  }
  return out;
}

const rank = (node) => {
  const place = ORDER.indexOf(node.status ?? "");
  return place === -1 ? ORDER.length : place;
};

/** Папки первыми, дальше по состоянию: чем нужнее внимание, тем выше. */
function sort(nodes) {
  nodes.sort(
    (a, b) =>
      Number(Boolean(b.isDir)) - Number(Boolean(a.isDir)) ||
      rank(a) - rank(b) ||
      a.label.localeCompare(b.label, "ru"),
  );
  for (const node of nodes) if (node.isDir) sort(node.children);
  return nodes;
}

const mine = process.argv.includes("--own");

const input = await new Promise((resolve) => {
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => resolve(raw));
});

const tree = convert(JSON.parse(input || "{}").children);
mark(tree);

const children = sort(process.argv.includes("--todo") ? todoOnly(tree) : tree);
process.stdout.write(JSON.stringify({ children }));
