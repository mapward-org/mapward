/**
 * Показать файл или папку в проводнике — тестовый экшон корня карты (решение 0038).
 * Путь приходит полем формы, переменной `MAPWARD_INPUT_PATH`.
 *
 * Коду выхода проводника не верим: `explorer` возвращает единицу и тогда, когда всё открыл.
 * Поэтому путь проверяется заранее, и ошибка — только если его нет.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const raw = process.env.MAPWARD_INPUT_PATH ?? "";
const path = resolve(raw);
if (!raw || !existsSync(path)) {
  console.error(`Пути нет: ${raw || "(пусто)"}`);
  process.exit(1);
}

const isDir = statSync(path).isDirectory();
const [command, args] =
  process.platform === "win32"
    ? ["explorer", isDir ? [path] : [`/select,${path}`]]
    : process.platform === "darwin"
      ? ["open", isDir ? [path] : ["-R", path]]
      : ["xdg-open", [isDir ? path : dirname(path)]];

spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false }).unref();
console.log(isDir ? `Открыл папку ${path}` : `Показал файл ${path}`);
