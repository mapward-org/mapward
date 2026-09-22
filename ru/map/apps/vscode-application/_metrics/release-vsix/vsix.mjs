/**
 * Что собрано и что из этого стоит в редакторе.
 *
 * Вопрос «а установленное расширение — это то, что я только что собрал?» иначе не проверяется:
 * номер версии стоит на месте, пока его не бампнули changeset'ом, и `mapward.mapward@0.0.0`
 * в списке редактора одинаково выглядит и час назад, и минуту. Поэтому в строке установленного
 * стоит время: когда папку расширения переписали установкой.
 *
 * Установленное спрашивается у `code --list-extensions` — это те же 400 мс, что у любого запуска
 * cli редактора, и оно честнее, чем чтение `~/.vscode/extensions`: тот путь меняется вместе с
 * форматом редактора, а cli — публичный интерфейс.
 *
 * Аргумент — корень проекта (`mapward://@`).
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = process.argv[2].replaceAll("\\", "/").replace(/\/+$/, "");
const buildDir = join(root, "apps/vscode-extension/build");

const when = (ms) =>
  new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const items = [];

// --- Что стоит в редакторе -----------------------------------------------------------------

let installed = null;
try {
  // `code` на windows — .cmd, без оболочки его не позвать.
  const out = execFileSync("code", ["--list-extensions", "--show-versions"], {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  installed = out.split("\n").map((line) => line.trim()).find((line) => line.startsWith("mapward.")) ?? "";
} catch {
  installed = null;
}

if (installed === null) {
  items.push({
    label: "Редактор не ответил",
    description: "`code` не нашёлся в PATH — установленную версию не спросить",
    status: "pending",
  });
} else if (installed === "") {
  items.push({
    label: "В редакторе не стоит",
    description: "поставить — кнопка «Собрать и поставить» ниже",
    status: "pending",
  });
} else {
  // Время установки — mtime папки расширения: её переписывает каждая установка.
  const dir = join(homedir(), ".vscode/extensions", installed.replace("@", "-"));
  let stamp = null;
  try {
    stamp = statSync(dir).mtimeMs;
  } catch {
    stamp = null;
  }

  items.push({
    label: `В редакторе стоит ${installed}`,
    description: stamp === null
      ? "поставлено; после установки нужен Developer: Reload Window"
      : `поставлено ${when(stamp)}; после установки нужен Developer: Reload Window`,
    status: "success",
  });
}

// --- Что собрано ------------------------------------------------------------------------------

let packages = [];
try {
  packages = readdirSync(buildDir)
    .filter((name) => name.endsWith(".vsix"))
    .map((name) => {
      const path = join(buildDir, name);
      const stat = statSync(path);
      return { name, path, size: stat.size, mtime: stat.mtimeMs };
    })
    .toSorted((a, b) => b.mtime - a.mtime);
} catch {
  packages = [];
}

if (packages.length === 0) {
  items.push({
    label: "Пакета нет",
    description: "`build/` пуст — собрать нечего ставить",
    status: "idle",
  });
} else {
  for (const item of packages) {
    items.push({
      label: item.name,
      description: `${(item.size / 1024 / 1024).toFixed(2)} МБ, ${when(item.mtime)}`,
      link: item.path.replaceAll("\\", "/"),
      status: "idle",
    });
  }
}

process.stdout.write(JSON.stringify({ items }));
