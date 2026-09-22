/**
 * Что в рабочем дереве не закоммичено — `git status --porcelain` списком.
 *
 * Пометки `git` в деревьях метрик показывают состояние файла, на который ты уже смотришь.
 * Вопрос же обычно обратный: что вообще тронуто. Порядок работы с директивой на этом и
 * держится — коммит точечно до прогона, разбор диффа после, — и до сих пор ответ на него
 * добывался походом в терминал мимо карты.
 *
 * Аргумент — корень проекта (`mapward://@`), он же cwd для git.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = process.argv[2].replaceAll("\\", "/").replace(/\/+$/, "");

const MEANING = {
  M: "изменён",
  A: "добавлен",
  D: "удалён",
  R: "переименован",
  C: "скопирован",
  U: "конфликт",
  "?": "не под git",
  "!": "игнорируется",
};

let output = "";
try {
  output = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (error) {
  // Упавший git — не пустое дерево: молчать об этом нельзя.
  process.stdout.write(
    JSON.stringify({
      items: [{ label: "git не ответил", description: String(error.message).trim(), status: "fail" }],
    }),
  );
  process.exit(0);
}

/**
 * `-z` вместо построчного разбора: имена с пробелами и кириллицей git иначе отдаёт
 * закавыченными и в escape-последовательностях, и путь приходится расшифровывать обратно.
 */
const records = output.split("\0").filter(Boolean);

const items = [];
for (let i = 0; i < records.length; i += 1) {
  const record = records[i];
  const index = record[0];
  const tree = record[1];
  let path = record.slice(3);

  // У переименования следом отдельной записью идёт прежнее имя — оно нам не нужно.
  if (index === "R" || index === "C") i += 1;

  const marks = [index, tree].filter((mark) => mark && mark !== " ");
  const spelled = [...new Set(marks.map((mark) => MEANING[mark] ?? mark))].join(", ");
  const staged = index !== " " && index !== "?";

  items.push({
    label: path,
    link: join(root, path).replaceAll("\\", "/"),
    description: `${spelled}${staged ? ", в индексе" : ""}`,
    status: marks.includes("U") ? "fail" : marks.includes("?") ? "idle" : "pending",
  });
}

process.stdout.write(JSON.stringify({ items }));
