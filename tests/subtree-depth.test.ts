import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * Поддерево карты читается с глубиной, и вся ветка — только явным `Infinity`. Всё, что под
 * адресом, модель держит прочитанным и под вотчером, пока поток жив, а `Infinity` от корня — это
 * вся карта: ровно то, от чего сервер отучен. Один удобный вызов в диффе выглядит безобидно —
 * поэтому каждый `Infinity` вне живой модели записан здесь с причиной, и новый без записи валит
 * тест.
 *
 * Считается каждый `Infinity` в коде: вне живой модели он ни для чего, кроме глубины, не нужен.
 * Сама модель (`LiveMap` в фиче `map` сервера) глубину и толкует — она не в счёт. Тесты не
 * смотрятся: им маленькая карта в памяти нужна целиком.
 */
const EXCEPTIONS: Record<string, { count: number; why: string }> = {
  "packages/abstract-server/src/entry/server.ts": {
    count: 2,
    why: "проверка плагина ищет метрики, которые его зовут, по всей карте — разово, по просьбе человека; правка карты переписывает адреса по всей карте — на время операции",
  },
  "packages/abstract-server/src/features/plugins/application/services/plugin-host.ts": {
    count: 1,
    why: "перевод протокола: JSON не переносит Infinity, плагин шлёт null — глубину он назвал сам",
  },
  "packages/plugins/registry/objects-map/index.ts": {
    count: 1,
    why: "операция холста ищет связи к удаляемому и концы стрелок по всей карте и держит её только на время пачки",
  },
  "ru/map/_plugins/objects-map/index.ts": {
    count: 1,
    why: "копия objects-map в карте этого репозитория — то же, что в реестре",
  },
  "packages/plugins/registry/objects-map/model/view.ts": {
    count: 4,
    why: "вьюха: маска `x/**`, раскрытые рамки, связи из placeRelations; объекты прототипа по всей карте — иначе как обходом их не найти",
  },
  "ru/map/_plugins/objects-map/model/view.ts": {
    count: 4,
    why: "копия objects-map в карте этого репозитория — то же, что в реестре",
  },
};

const ROOTS = ["packages", "apps", "ru/map/_plugins"];
/** Живая модель: глубину поддерева толкует она сама. */
const LIVE_MODEL = "packages/abstract-server/src/features/map/application/services/live-map.ts";
const SKIP = new Set(["node_modules", "dist", ".mapward"]);

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sources(full);
      const name = entry.name;
      const code = /\.(ts|tsx|mts|mjs)$/.test(name);
      const skipped =
        /\.test\.tsx?$/.test(name) || name.endsWith(".d.ts") || name.includes(".generated.");
      return code && !skipped ? [full] : [];
    }),
  );
  return nested.flat();
}

/**
 * Сколько раз `Infinity` встречается в коде — без комментариев и строк: глубина бывает и
 * аргументом вызова, и данными (`depth: Infinity`), и выбором (`frames ? Infinity : depth`), и
 * ловить каждый вид отдельно — значит пропустить следующий.
 */
function infinities(text: string): number {
  // Одним проходом: что началось раньше — комментарий или строка, — то и вырезается целиком.
  const code = text.replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
    "",
  );
  return [...code.matchAll(/\bInfinity\b/g)].length;
}

test("вне живой модели поддерево целиком читают только записанные исключения", async () => {
  const files = (await Promise.all(ROOTS.map((root) => sources(root)))).flat();
  expect(files.length).toBeGreaterThan(0);

  const counted = await Promise.all(
    files.map(async (file) => {
      const name = file.split(path.sep).join("/");
      if (name === LIVE_MODEL) return [name, 0] as const;
      return [name, infinities(await readFile(file, "utf8"))] as const;
    }),
  );
  const found = Object.fromEntries(counted.filter(([, count]) => count > 0));
  const expected = Object.fromEntries(
    Object.entries(EXCEPTIONS).map(([file, { count }]) => [file, count]),
  );
  expect(found, "Infinity в поддереве без записи в EXCEPTIONS — или запись устарела").toEqual(
    expected,
  );
});
