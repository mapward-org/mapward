/**
 * Относительные ссылки в доках — куда ведут и все ли на месте.
 *
 * Доки ссылаются друг на друга путями `[текст](../decisions/0004.md)`, и переименование файла
 * молча рвёт ссылки на него: markdown не проверяет, куда ведёт. Скрипт обходит тексты, которые
 * пишут люди и агенты, — `ru/docs`, `ru/requirements`, `ru/memories` и в карте директивы,
 * экшоны и workflow-подсказки, — и сверяет каждую ссылку с диском.
 *
 * На выходе две вещи. `items` — битые ссылки, по строке на каждую: это видит человек в дисплее
 * `list`. `backlinks` — обратный индекс «файл → кто на него ссылается»: это для агента, который
 * собирается файл переименовать или удалить и хочет знать, что поправить следом. Дисплей
 * `backlinks` не рисует, но в значении метрики он лежит.
 *
 * Не считаются ссылки наружу (`http(s):`, `mailto:`), на объекты карты (`mapward://`) и чистые
 * якоря (`#раздел`); якорь в конце пути отрезается и не проверяется — заголовки правят чаще,
 * чем имена файлов, и шум от них заглушил бы главное. Код — блоком и в строке — тоже мимо:
 * там ссылка пример, а не ссылка.
 *
 * Выполненная директива — история: её текст писался под тогдашнее дерево и чинить его незачем.
 * Поэтому директива со `status: "done"` в своём `.state.json` пропускается.
 *
 * Аргумент — корень проекта (`mapward://@`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const slash = (value = "") => value.replaceAll("\\", "/").replace(/\/+$/, "");

const root = slash(resolve(process.argv[2] ?? "."));

/** Папки, куда не заходим: там не наши тексты. */
const SKIP = new Set(["node_modules", "dist", ".git"]);

const listing = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/** Все `.md` в поддереве. */
function* markdown(dir) {
  for (const entry of listing(dir)) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdown(path);
    else if (entry.name.endsWith(".md")) yield path;
  }
}

/** Папки карты с данным именем — на любой глубине. */
function* folders(dir, name) {
  for (const entry of listing(dir)) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.name === name) yield path;
    else yield* folders(path, name);
  }
}

/** `.md` прямо в папке, без вложенных. */
const shallow = (dir) =>
  listing(dir)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(dir, entry.name));

/** Выполнена ли директива: состояние лежит рядом, в `_directives.state/<имя>.state.json`. */
function done(file) {
  const name = file.replace(/^.*[\\/]/, "").replace(/\.md$/, "");
  const state = join(dirname(dirname(file)), "_directives.state", `${name}.state.json`);
  try {
    return JSON.parse(readFileSync(state, "utf8")).status === "done";
  } catch {
    return false;
  }
}

function sources() {
  const found = [];
  for (const dir of ["ru/docs", "ru/requirements", "ru/memories"]) {
    found.push(...markdown(join(root, dir)));
  }

  const map = join(root, "ru/map");
  for (const dir of folders(map, "_directives.workflow")) found.push(...shallow(dir));
  for (const dir of folders(map, "_actions")) found.push(...shallow(dir));
  for (const dir of folders(map, "_directives")) {
    found.push(...shallow(dir).filter((file) => !done(file)));
  }

  return found;
}

/** Ссылка вида `[текст](путь)` или `[текст](путь "заголовок")`, в том числе у картинки. */
const LINK = /\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/** Не путь в проекте: схема (`https:`, `mailto:`, `mapward:`) или чистый якорь. */
const external = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#");

/** Инлайн-код гасится пробелами той же длины — чтобы не сбить ничего в строке. */
const withoutCode = (line) => line.replace(/(`+)[\s\S]*?\1/g, (code) => " ".repeat(code.length));

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Ссылки файла с номерами строк, мимо блоков кода. */
function* linksOf(text) {
  let fence;

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line);
    if (opener) {
      // Блок закрывает та же черта не короче открывшей — как у CommonMark.
      if (!fence) fence = opener[1];
      else if (opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;

    for (const match of withoutCode(line).matchAll(LINK)) {
      const target = match[1].replace(/^<|>$/g, "").trim();
      if (!target || external(target)) continue;
      const path = decode(target.replace(/[#?].*$/, ""));
      if (path) yield { line: index + 1, target, path };
    }
  }
}

const rel = (path) => slash(relative(root, path));

const broken = [];
const backlinks = {};

for (const file of sources()) {
  const source = rel(file);
  // Обход последовательный: файлов сотни, а читается он понятнее.
  const text = readFileSync(file, "utf8");

  for (const link of linksOf(text)) {
    const full = resolve(dirname(file), link.path);
    if (existsSync(full)) {
      (backlinks[rel(full)] ??= []).push({ file: source, line: link.line });
    } else {
      broken.push({ file: source, line: link.line, target: link.target, link: slash(file) });
    }
  }
}

const items = broken.map((entry) => ({
  label: `${entry.file}:${entry.line}`,
  description: `ведёт на \`${entry.target}\` — такого файла нет`,
  // Абсолютный путь: по нему дисплей открывает файл, а шаг `git-status` находит репозиторий.
  link: entry.link,
  status: "fail",
}));

const sorted = Object.fromEntries(
  Object.entries(backlinks).toSorted(([left], [right]) => left.localeCompare(right)),
);

process.stdout.write(
  JSON.stringify({
    ok: broken.length === 0,
    items,
    broken: broken.map(({ file, line, target }) => ({ file, line, target })),
    backlinks: sorted,
  }),
);
