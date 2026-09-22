/**
 * Решения в том виде, в каком их спрашивают, а не в виде списка файлов.
 *
 * Метрика «Решения» отдаёт дерево `ru/docs/decisions`, а у неё каждый прогон спрашивают
 * одно и то же: какой номер брать следующим, есть ли у решения инвариант, кто кого
 * перекрывает. Выяснялось это чтением двух десятков файлов подряд — здесь оно посчитано.
 *
 * Номер следующий — от последнего существующего, а не от первой дыры: пропущенный номер
 * не переиспользуется. Пропуски показаны отдельной строкой, чтобы это было видно, а не
 * предполагалось.
 *
 * Перекрытия карта обратными ссылками не держит. Ищутся они так, как их и ставят руками —
 * строкой-цитатой в начале переопределённого раздела, где упомянут номер другого решения.
 * Направление по тексту не выводится: цитата показана как есть, а кто кого — видно по ней.
 *
 * Аргумент — корень проекта (`mapward://@`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2].replaceAll("\\", "/").replace(/\/+$/, "");
const dir = join(root, "ru/docs/decisions");

const files = readdirSync(dir)
  .filter((name) => /^\d{4}-.*\.md$/.test(name))
  .toSorted();

const decisions = files.map((name) => {
  const text = readFileSync(join(dir, name), "utf8");
  const number = name.slice(0, 4);
  const lines = text.split(/\r?\n/);

  return {
    number,
    name,
    // У самых первых решений заголовок второго уровня — берём первый любой.
    title: /^#{1,2}\s+(.+)$/m.exec(text)?.[1]?.trim() ?? name,
    invariant: /^##\s+Инвариант\s*$/m.test(text),
    // Пометка о перекрытии — цитата, в которой назван номер другого решения.
    notes: lines
      .filter((line) => line.startsWith(">"))
      .map((line) => line.replace(/^>\s?/, "").trim())
      .filter((line) => (line.match(/\b0\d{3}\b/g) ?? []).some((found) => found !== number)),
  };
});

const numbers = decisions.map((decision) => Number(decision.number));
const last = Math.max(...numbers);
const next = String(last + 1).padStart(4, "0");
const missing = [];
for (let i = 1; i < last; i += 1) {
  if (!numbers.includes(i)) missing.push(String(i).padStart(4, "0"));
}

const without = decisions.filter((decision) => !decision.invariant).map((d) => d.number);

const items = [
  {
    label: `Следующий номер — ${next}`,
    description:
      `Последнее решение ${String(last).padStart(4, "0")}, всего ${decisions.length}.` +
      (missing.length > 0
        ? ` ${missing.length === 1 ? "Пропущен" : "Пропущены"} ${missing.join(", ")} — ` +
          "пропущенный номер не переиспользуется."
        : ""),
    status: "success",
  },
  {
    label: `Без инварианта — ${without.length}`,
    // Не ошибка: раздел «Инвариант» завели по ходу дела, и ранние решения его не знали.
    description: without.length > 0 ? without.join(", ") : "у всех решений инвариант есть",
    status: "idle",
  },
  ...decisions.map((decision) => ({
    label: `${decision.number} — ${decision.title}`,
    link: join(dir, decision.name).replaceAll("\\", "/"),
    description: [
      decision.invariant ? "инвариант есть" : "инварианта нет",
      ...decision.notes.map((note) => `перекрытие: ${note}`),
    ].join(" · "),
    status: "idle",
  })),
];

process.stdout.write(JSON.stringify({ items }));
