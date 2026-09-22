/**
 * Догнала ли сборка исходники — по пакету на строку.
 *
 * Живой MCP отвечает из собранного расширения, а не из `src`: правка в исходниках до него
 * не доезжает, пока не пересобрали. На этом спотыкается каждый второй прогон — агент правит
 * код, зовёт MCP и видит прежнее поведение, считая, что правка не сработала.
 *
 * Спрашивается это у turbo, а не у времён файлов. Сравнение mtime здесь врёт в обе стороны:
 * `tsc` кладёт сгенерированные `.d.ts` рядом с исходниками, и один `typecheck` делает `src`
 * свежее `dist` у всех пакетов разом, ничего в них не поменяв. `turbo run build --dry=json`
 * отвечает готовым `cache.status` по той же хэш-модели, по которой сборка и решает, работать
 * ей или нет, — и укладывается в семьсот миллисекунд, потому что ничего не собирает.
 *
 * Время `dist` в строке остаётся справочным: `HIT` значит «пересобирать нечего», но не
 * «загруженное расширение свежее» — окно редактора могли не перезагрузить после сборки.
 *
 * Аргумент — корень проекта (`mapward://@`).
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2].replaceAll("\\", "/").replace(/\/+$/, "");

const listing = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
};

/** Самое позднее время правки в поддереве; папки нет — `null`, а не ноль. */
function newest(dir) {
  const entries = listing(dir);
  if (entries === null) return null;

  let latest = 0;
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) latest = Math.max(latest, newest(path) ?? 0);
    else latest = Math.max(latest, statSync(path).mtimeMs);
  }
  return latest || null;
}

const when = (ms) =>
  new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

let plan;
try {
  // Запускается node-ом напрямую: `node_modules/.bin/turbo` на windows — .CMD, и его
  // не позвать без оболочки, а сам `bin/turbo` пакета — обычный js со своим shebang.
  const out = execFileSync(
    process.execPath,
    [join(root, "node_modules/turbo/bin/turbo"), "run", "build", "--dry=json"],
    // stderr ловим, а не отдаём наружу: turbo печатает туда свою версию каждым запуском,
    // и рантайм писал бы из-за этого `collect.logs.json` на каждый взгляд на вкладку.
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  plan = JSON.parse(out);
} catch (error) {
  // Молчать нельзя: пустой список здесь читался бы как «всё собрано».
  process.stdout.write(
    JSON.stringify({
      items: [
        {
          label: "turbo не ответил",
          description: String(error.message).split("\n")[0],
          status: "fail",
        },
      ],
    }),
  );
  process.exit(0);
}

const tasks = (plan.tasks ?? []).filter((task) => task.task === "build");

const items = tasks.map((task) => {
  const stale = task.cache?.status !== "HIT";
  // Папку turbo отдаёт windows-путём, а ссылке нужен тот же вид, что у остальных метрик.
  const directory = task.directory?.replaceAll("\\", "/");
  const dist = directory === undefined ? null : newest(join(root, directory, "dist"));

  return {
    label: task.package ?? task.taskId,
    link: directory === undefined ? undefined : join(root, directory).replaceAll("\\", "/"),
    description: stale
      ? "turbo считает сборку устаревшей — пересобрать"
      : dist === null
        ? "собрано, dist на месте не найден"
        : `собрано, dist ${when(dist)}`,
    status: stale ? "fail" : "success",
  };
});

const stale = items.filter((item) => item.status === "fail").length;

items.unshift({
  label:
    stale > 0
      ? `Пересобрать — ${stale} из ${items.length}`
      : `Сборка догнала исходники — все ${items.length}`,
  description:
    "по `turbo run build --dry=json`; `dist` свежий не значит, что окно редактора перезагружено",
  status: stale > 0 ? "fail" : "success",
});

process.stdout.write(JSON.stringify({ items }));
