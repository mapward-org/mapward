/**
 * Файловые операции экшонов прототипа «Система»: переименовать, удалить, новый файл, новая папка.
 *
 *   node file-ops.mjs <rename|delete|new-file|new-folder> <папка объекта>
 *
 * Папку объекта передаёт карта аргументом, данные формы приходят переменными
 * `MAPWARD_INPUT_<ИМЯ>`. Что верно для всех операций:
 * - за папку объекта не выходим — путь с `..` или чужой абсолютный путь это отказ;
 * - существующее не затираем — переименование или создание поверх готового это отказ;
 * - удаляем насовсем, без корзины: страхуют вопрос перед запуском и git;
 * - переименовываем обычным переименованием, без `git mv`: git сам увидит его при коммите.
 */

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const input = (name) => (process.env[`MAPWARD_INPUT_${name.toUpperCase()}`] ?? "").trim();

const [op, baseArg] = process.argv.slice(2);
if (!baseArg) fail("Не передана папка объекта — вторым аргументом.");
const base = resolve(baseArg);
if (!existsSync(base)) fail(`Папки объекта нет: ${base}`);

/** Внутри папки объекта, и не сама она: папку объекта экшоны не трогают. */
function inside(path) {
  const rel = relative(base, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

const shown = (path) => relative(base, path).replaceAll("\\", "/") || ".";

/** Путь из формы — существующий и внутри папки объекта. */
function target(name) {
  const raw = input(name);
  if (!raw) fail(`Не задано поле ${name}.`);
  const path = resolve(base, raw);
  if (path === base) fail("Саму папку объекта эти экшоны не трогают.");
  if (!inside(path)) fail(`${raw} — за пределами папки объекта ${base}.`);
  if (!existsSync(path)) fail(`Такого пути нет: ${shown(path)}`);
  return path;
}

/** Куда создавать: папка из формы (сама папка объекта тоже годится) и имя, можно вложенное. */
function created() {
  const folder = resolve(base, input("folder") || base);
  if (folder !== base && !inside(folder)) fail(`${folder} — за пределами папки объекта ${base}.`);
  const name = input("name");
  if (!name) fail("Не задано имя.");
  const path = resolve(folder, name);
  if (!inside(path)) fail(`${name} — за пределами папки объекта ${base}.`);
  if (existsSync(path)) fail(`Уже есть: ${shown(path)} — не затираю.`);
  return path;
}

if (op === "rename") {
  const from = target("path");
  const name = input("name");
  if (!name) fail("Не задано новое имя.");
  if (/[\\/]/.test(name)) fail(`Новое имя — одно имя, без папок: ${name}`);
  const to = join(dirname(from), name);
  if (to === from) fail("Имя не изменилось.");
  // Смена только регистра на Windows — тот же файл: existsSync ответит «есть», но затирать нечего.
  const sameFile = to.toLowerCase() === from.toLowerCase();
  if (existsSync(to) && !sameFile) fail(`Уже есть: ${shown(to)} — не затираю.`);
  renameSync(from, to);
  console.log(`Переименовал ${shown(from)} → ${basename(to)}`);
} else if (op === "delete") {
  const path = target("path");
  rmSync(path, { recursive: true });
  console.log(`Удалил ${shown(path)}`);
} else if (op === "new-file") {
  const path = created();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", { flag: "wx" });
  console.log(`Создал файл ${shown(path)}`);
} else if (op === "new-folder") {
  const path = created();
  mkdirSync(path, { recursive: true });
  console.log(`Создал папку ${shown(path)}`);
} else {
  fail(
    `Неизвестная операция: ${op ?? "(пусто)"} — ждётся rename, delete, new-file или new-folder.`,
  );
}
