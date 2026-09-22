/**
 * Собрать `.vsix` и, по флагу, поставить его в свой редактор.
 *
 * Пакуется не сама папка пакета, а её слепок в `build/stage`. Так сделано потому, что манифест
 * монорепы и манифест расширения — разные документы, которым нужны разные вещи:
 *
 * - `vsce` не принимает scoped-имя, а `@mapward/vscode-extension` — это идентичность воркспейса,
 *   по ней работают `pnpm --filter` и turbo. В слепке имя становится `mapward`, в репозитории
 *   остаётся прежним;
 * - `"private": true` держит пакет вне npm (`changeset publish` о него спотыкается намеренно),
 *   а `vsce` на нём останавливается. В слепке поля просто нет;
 * - `workspace:*` в зависимостях `vsce` не понимает. В слепке зависимостей нет вовсе — оба
 *   бандла самодостаточны, наружу вынесен только `vscode`, который даёт хост.
 *
 * Отсюда же следует, что `.vscodeignore` не нужен: в пакет уезжает ровно то, что сюда скопировано.
 *
 * Использование:
 *   node scripts/package-vsix.mjs             — собрать прод-сборкой и упаковать
 *   node scripts/package-vsix.mjs --install   — то же и поставить в редактор
 *   node scripts/package-vsix.mjs --json      — отчёт машинно, для метрики карты
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(extensionDir, "../..");
const buildDir = join(extensionDir, "build");
const stageDir = join(buildDir, "stage");

const install = process.argv.includes("--install");
const asJson = process.argv.includes("--json");

const steps = [];
const say = (label, description, status = "success") => {
  steps.push({ label, description, status });
  if (!asJson)
    console.log(
      `${status === "success" ? "·" : "!"} ${label}${description ? ` — ${description}` : ""}`,
    );
};

const finish = (code) => {
  if (asJson) process.stdout.write(JSON.stringify({ items: steps }));
  process.exit(code);
};

const manifest = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
const version = manifest.version;

// --- Сборка прод-режимом ---------------------------------------------------------------------
//
// Зовётся turbo, а не `pnpm build` в папке: у расширения есть зависимости-пакеты, и собрать надо
// их тоже. `NODE_ENV` объявлен в `turbo.json` как вход задачи, поэтому дев-сборка из кэша сюда
// не подставится.

try {
  execFileSync(
    process.execPath,
    [join(root, "node_modules/turbo/bin/turbo"), "run", "build", "--filter", manifest.name],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: asJson ? "pipe" : "inherit",
    },
  );
  say("Сборка", "прод-режим, NODE_ENV=production");
} catch (error) {
  say("Сборка упала", String(error.message).split("\n")[0], "fail");
  finish(1);
}

// --- Слепок для упаковки ---------------------------------------------------------------------

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

cpSync(join(extensionDir, "dist"), join(stageDir, "dist"), { recursive: true });
cpSync(join(extensionDir, "media"), join(stageDir, "media"), { recursive: true });
cpSync(join(extensionDir, "README.md"), join(stageDir, "README.md"));

const license = ["LICENSE", "LICENSE.md", "LICENSE.txt"]
  .map((name) => join(root, name))
  .find((path) => existsSync(path));
if (license !== undefined) cpSync(license, join(stageDir, "LICENSE"));

const staged = {
  name: "mapward",
  displayName: manifest.displayName,
  description: manifest.description,
  version,
  publisher: manifest.publisher,
  categories: manifest.categories,
  repository: manifest.repository,
  engines: { vscode: manifest.engines.vscode },
  main: manifest.main,
  activationEvents: manifest.activationEvents,
  contributes: manifest.contributes,
};
if (manifest.icon !== undefined) {
  staged.icon = manifest.icon;
  cpSync(join(extensionDir, manifest.icon), join(stageDir, manifest.icon));
}

writeFileSync(join(stageDir, "package.json"), `${JSON.stringify(staged, null, 2)}\n`);
say("Слепок", `build/stage, имя пакета «${staged.name}», версия ${version}`);

// --- Упаковка ----------------------------------------------------------------------------------

const vsix = join(buildDir, `mapward-${version}.vsix`);
// Точка входа пакета, а не `.bin`: на windows там `.CMD`, который без оболочки не позвать.
const vsce = join(
  dirname(createRequire(join(extensionDir, "package.json")).resolve("@vscode/vsce/package.json")),
  "vsce",
);

try {
  execFileSync(process.execPath, [vsce, "package", "--no-dependencies", "--out", vsix], {
    cwd: stageDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  say(
    "Упаковка упала",
    String(error.stderr || error.message)
      .split("\n")
      .filter(Boolean)
      .pop(),
    "fail",
  );
  finish(1);
}

const size = `${(statSync(vsix).size / 1024 / 1024).toFixed(2)} МБ`;
say("Пакет", `${vsix.replaceAll("\\", "/")}, ${size}`);

// --- Установка ---------------------------------------------------------------------------------

if (install) {
  // `--force` обязателен: версия монорепы двигается changeset'ами, и та же самая ставится
  // поверх себя каждый раз, пока номер не бампнули.
  const result = spawnSync("code", ["--install-extension", `"${vsix}"`, "--force"], {
    shell: true,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    say(
      "Установка упала",
      String(result.stderr || result.stdout)
        .split("\n")
        .filter(Boolean)
        .pop() ?? "code вернул ошибку",
      "fail",
    );
    finish(1);
  }

  say("Установлено", "перезагрузи окно редактора: Developer: Reload Window");
}

finish(0);
