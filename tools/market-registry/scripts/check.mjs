#!/usr/bin/env node
/**
 * Проверка pull request'а в реестр: форма индексов и e2e — присланное ставится в пустую карту и
 * запускается. Комментарии — только по форме, не по содержанию.
 *
 *   node check.mjs --base <папка main> --pr <папка pull request'а> --out <папка ответа>
 *
 * Скрипт берётся из `main` (папка `--base`), а не из pull request'а: иначе pull request мог бы
 * поправить саму проверку. Индексы читаются из `--pr`. Ставит и проверяет `mapward` из npm.
 *
 * В `--out` ложатся `result.json` ({ ok, human, entries }) и `comment.md` — их читает `merge.yml`,
 * которому даны права на запись; здесь прав нет.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const INDEXES = { plugin: "plugins.json", map: "maps.json" };
const ALLOWED = new Set(Object.values(INDEXES));
const STEP_TIMEOUT_MS = 5 * 60_000;

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let at = 0; at < argv.length; at += 2) out[argv[at].replace(/^--/, "")] = argv[at + 1];
  for (const key of ["base", "pr", "out"]) {
    if (!out[key]) throw new Error(`нужен --${key}`);
    out[key] = resolve(out[key]);
  }
  return out;
}

/** Команда с выводом целиком; код выхода, а не исключение. */
function run(command, argv, options = {}) {
  return new Promise((done) => {
    const child = spawn(command, argv, { shell: process.platform === "win32", ...options });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), STEP_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, output });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ code: 1, output: `${output}\n${error.message}` });
    });
  });
}

async function readIndex(dir, kind) {
  try {
    return JSON.parse(await readFile(join(dir, INDEXES[kind]), "utf8"));
  } catch {
    return [];
  }
}

/** Файлы папки рекурсивно, без `.git`. */
async function list(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await list(dir, path)));
    else files.push(path);
  }
  return files;
}

/** Файлы, которыми pull request отличается от main: всё, кроме индексов, — к человеку. */
async function changedFiles(base, pr) {
  const [left, right] = await Promise.all([list(base), list(pr)]);
  const changed = [];
  for (const path of new Set([...left, ...right])) {
    const [a, b] = await Promise.all(
      [base, pr].map((dir) => readFile(join(dir, path), "utf8").catch(() => undefined)),
    );
    if (a !== b) changed.push(path);
  }
  return changed;
}

/** MCP `mapward mcp` по stdio: один вызов инструмента, ответ — разобранный json. */
function mcpCall(cwd, env, name, toolArgs) {
  return new Promise((done) => {
    const child = spawn("mapward", ["mcp"], { cwd, env, shell: process.platform === "win32" });
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ error: "mapward mcp не ответил за 5 минут" });
    }, STEP_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const cut = buffer.indexOf("\n");
      if (cut === -1) return;
      clearTimeout(timer);
      child.kill();
      const reply = JSON.parse(buffer.slice(0, cut));
      if (reply.error) done({ error: reply.error.message });
      else done({ value: JSON.parse(reply.result?.content?.[0]?.text ?? "null") });
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: toolArgs } })}\n`,
    );
  });
}

/** Адрес объекта и адреса всех объектов под ним — папок с `_index.json`, и за полками тоже. */
async function nested(mapDir, address, isObject = true) {
  const path = address.replace(/^mapward:\/\//, "");
  const found = isObject ? [address] : [];
  const entries = await readdir(join(mapDir, path), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const index = await readFile(join(mapDir, path, entry.name, "_index.json")).catch(() => null);
    found.push(...(await nested(mapDir, `${address}/${entry.name}`, index !== null)));
  }
  return found;
}

const fence = (text) => `\`\`\`\n${text.trim().slice(-6000)}\n\`\`\``;

/** Строка индекса — в пустую карту: поставить и запустить. */
async function e2e(entry, kind, registry) {
  const root = await mkdtemp(join(tmpdir(), "market-check-"));
  await mkdir(join(root, "map"), { recursive: true });
  await writeFile(join(root, "mapward.json"), JSON.stringify({ maps: [{ mapUrl: "map" }] }));
  await writeFile(join(root, "map", "_index.json"), JSON.stringify({ name: "Проверка" }));
  const env = { ...process.env, MAPWARD_MARKET: registry };
  const log = [];

  const added = await run("mapward", ["market", "add", entry.name, "--kind", kind, "--trust"], {
    cwd: root,
    env,
  });
  log.push(`$ mapward market add ${entry.name} --kind ${kind} --trust\n${added.output}`);
  if (added.code !== 0) return { ok: false, log };

  let result;
  try {
    result = JSON.parse(
      added.output.slice(added.output.indexOf("{"), added.output.lastIndexOf("}") + 1),
    );
  } catch {
    log.push("ответ market add не разобрался");
    return { ok: false, log };
  }

  // Плагины: свой и те, что кусок поставил из реестра, — сборка, процесс, самоописание.
  const plugins =
    kind === "plugin"
      ? [result.plugin]
      : (result.plugins ?? []).filter((p) => !p.already).map((p) => p.plugin);
  let ok = true;
  for (const plugin of plugins.filter(Boolean)) {
    const checked = await run("mapward", ["plugin", "check", plugin], { cwd: root, env });
    log.push(`$ mapward plugin check ${plugin}\n${checked.output}`);
    if (checked.code !== 0) ok = false;
  }

  // Кусок карты: каждый объект, и вложенные тоже, — `check` правки карты: метрики собираются и
  // зовутся пробно. `created` называет только верхние объекты куска.
  const objects = [];
  for (const top of result.created ?? []) objects.push(...(await nested(join(root, "map"), top)));
  for (const address of objects) {
    const reply = await mcpCall(root, env, "edit_map", { ops: [{ op: "check", address }] });
    const report = reply.value?.results?.[0];
    log.push(`check ${address}\n${JSON.stringify(reply.error ?? report ?? reply.value, null, 2)}`);
    if (reply.error || !reply.value?.ok || !report?.ok) ok = false;
  }
  return { ok, log };
}

async function main() {
  const { base, pr, out } = args();
  await mkdir(out, { recursive: true });
  const entries = [];
  const problems = [];

  const changed = await changedFiles(base, pr);
  const foreign = changed.filter((path) => !ALLOWED.has(path));
  const human = foreign.length > 0 ? `меняет не только индексы: ${foreign.join(", ")}` : undefined;

  // Форма индексов — тем же разбором, что у платформы: ошибки он пишет в stderr поиска.
  const search = await run("mapward", ["market", "search"], {
    env: { ...process.env, MAPWARD_MARKET: pr },
  });
  const formErrors = search.output.split("\n").filter((line) => /\.json(\[\d+\])?[: ]/.test(line));
  problems.push(...formErrors);

  for (const kind of Object.keys(INDEXES)) {
    const before = new Map(
      (await readIndex(base, kind)).map((row) => [row.name, JSON.stringify(row)]),
    );
    const after = await readIndex(pr, kind);
    const names = new Set(after.map((row) => row.name));
    for (const name of before.keys()) {
      if (!names.has(name))
        problems.push(`${INDEXES[kind]}: ${name} удалён — удаление принимает человек`);
    }
    for (const row of after) {
      if (before.get(row.name) === JSON.stringify(row)) continue;
      if (formErrors.length > 0) continue;
      const checked = await e2e(row, kind, pr);
      entries.push({ kind, name: row.name, repo: row.repo, ...checked });
    }
  }

  const ok = problems.length === 0 && entries.every((entry) => entry.ok) && !human;
  const lines = [
    ok ? "✅ Проверка прошла — принимаю." : "❌ Проверка не прошла.",
    "",
    "Проверяется форма, а не содержание: строка индекса разбирается, присланное ставится в пустую карту `mapward market add --trust` и запускается (`mapward plugin check`, у куска карты — `check` каждого объекта).",
  ];
  if (human) lines.push("", `Pull request ${human} — его посмотрит человек.`);
  if (problems.length > 0) lines.push("", "**Форма:**", "", ...problems.map((line) => `- ${line}`));
  for (const entry of entries) {
    lines.push(
      "",
      `**${entry.kind === "plugin" ? "Плагин" : "Кусок карты"} \`${entry.name}\`** (${entry.repo}) — ${entry.ok ? "работает" : "не работает"}`,
    );
    if (!entry.ok) lines.push("", fence(entry.log.join("\n\n")));
  }
  if (entries.length === 0 && problems.length === 0 && !human)
    lines.push("", "Новых или изменённых строк нет.");

  await writeFile(
    join(out, "result.json"),
    JSON.stringify(
      { ok, human: human ?? null, entries: entries.map(({ log: _log, ...rest }) => rest) },
      null,
      2,
    ),
  );
  await writeFile(join(out, "comment.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  process.exit(ok ? 0 : 1);
}

await main();
