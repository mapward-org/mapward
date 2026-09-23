/**
 * Тестовый дисплей-компонент (решение 0037): решения проекта номером, заголовком и файлом.
 * Корень проекта приходит первым аргументом — в окружении скрипта его нет.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2].replaceAll("\\", "/").replace(/\/+$/, "");
const dir = join(root, "ru/docs/decisions");

const decisions = readdirSync(dir)
  .filter((name) => /^\d{4}-.*\.md$/.test(name))
  .map((name) => {
    const text = readFileSync(join(dir, name), "utf8");
    return {
      number: name.slice(0, 4),
      title: /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? name,
      file: `${root}/ru/docs/decisions/${name}`,
      draft: text.includes("Черновик агента"),
    };
  })
  .toSorted((a, b) => b.number.localeCompare(a.number));

console.log(JSON.stringify({ decisions }));
