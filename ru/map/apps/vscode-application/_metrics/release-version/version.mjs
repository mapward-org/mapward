/**
 * Какой номер поедет в `.vsix` и что за ним стоит.
 *
 * Своего ритма версий у расширения нет: номер общий на монорепу, его двигают changeset'ы, а
 * упаковка только читает готовое из `package.json` и сама ничего не бампает. Поэтому метрика
 * отвечает на три вопроса сразу: какой номер сейчас, накоплено ли что-то к следующему и
 * прокручивался ли механизм хоть раз (тег).
 *
 * Аргумент — корень проекта (`mapward://@`).
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2].replaceAll("\\", "/").replace(/\/+$/, "");

const json = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
};

const items = [];

const manifest = json(join(root, "apps/vscode-extension/package.json"));
const rootManifest = json(join(root, "package.json"));

if (manifest === null) {
  process.stdout.write(
    JSON.stringify({
      items: [{ label: "Манифеста расширения нет", description: "apps/vscode-extension/package.json", status: "fail" }],
    }),
  );
  process.exit(0);
}

const version = manifest.version;
const together = rootManifest?.version === version;

items.push({
  label: `Версия ${version}`,
  description: together
    ? "общая с монорепой; двигают changeset'ы, упаковка её только читает"
    : `в корне монорепы ${rootManifest?.version ?? "неизвестно"} — номера разошлись`,
  link: join(root, "apps/vscode-extension/package.json").replaceAll("\\", "/"),
  status: together ? "success" : "pending",
});

// --- Что накоплено к следующему номеру ---------------------------------------------------------

let pending = [];
try {
  pending = readdirSync(join(root, ".changeset"))
    .filter((name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md");
} catch {
  pending = [];
}

if (pending.length === 0) {
  items.push({
    label: "Changeset'ов нет",
    description: "версия не сдвинется, пока их не заведут — `pnpm changeset`",
    status: "idle",
  });
} else {
  items.push({
    label: `Changeset'ов накоплено — ${pending.length}`,
    description: "мердж PR «Version Packages» бампнёт версию и поставит тег",
    status: "pending",
  });

  for (const name of pending) {
    const path = join(root, ".changeset", name);
    const text = readFileSync(path, "utf8");
    // Тело changeset'а — всё после второго `---`; первая непустая строка и есть его суть.
    const summary = text.split("---").slice(2).join("---").split("\n").map((line) => line.trim())
      .find((line) => line.length > 0);

    items.push({
      label: name.replace(/\.md$/, ""),
      description: summary ?? "без описания",
      link: path.replaceAll("\\", "/"),
      status: "idle",
    });
  }
}

// --- Прокручивался ли механизм ------------------------------------------------------------------

const tag = git("describe", "--tags", "--abbrev=0");

if (tag === null) {
  const count = git("rev-list", "--count", "HEAD");
  items.push({
    label: "Тегов нет",
    description: `changesets заведены, но ни разу не прокручены; в истории ${count ?? "?"} коммитов`,
    status: "idle",
  });
} else {
  const count = git("rev-list", "--count", `${tag}..HEAD`);
  items.push({
    label: `С тега ${tag} — ${count ?? "?"} коммитов`,
    description: "столько войдёт в следующий номер",
    status: "idle",
  });
}

process.stdout.write(JSON.stringify({ items }));
