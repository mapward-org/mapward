import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * Инвариант решения 0041: фичи сервера друг друга не импортируют. Что фиче нужно от соседа, она
 * объявляет своим портом, а стыкует их сборка сервера. Один удобный импорт в диффе выглядит
 * безобидно — поэтому проверяет тест. Тесты фич не в счёт: тест собирает фичу, как сборка.
 */
const FEATURES = "packages/abstract-server/src/features";

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return Promise.resolve(
        entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [],
      );
    }),
  );
  return nested.flat();
}

test("фичи сервера связаны портами, а не импортами", async () => {
  const features = (await readdir(FEATURES, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(features.length).toBeGreaterThan(1);

  const offenders: string[] = [];
  for (const feature of features) {
    const root = path.resolve(FEATURES, feature);
    // oxlint-disable-next-line no-await-in-loop
    for (const file of await sources(root)) {
      // oxlint-disable-next-line no-await-in-loop
      const text = await readFile(file, "utf8");
      for (const [, spec] of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
        const target = path.resolve(path.dirname(file), spec as string);
        const inFeatures = target.startsWith(path.resolve(FEATURES) + path.sep);
        if (inFeatures && !target.startsWith(root + path.sep)) {
          offenders.push(`${path.relative(FEATURES, file)} → ${spec}`);
        }
      }
    }
  }

  expect(offenders).toEqual([]);
});
