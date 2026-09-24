import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * Инвариант решения 0014: зависимости идут в одну сторону. `core` не знает никого, клиент не
 * знает сервера, пакет не знает приложений. В диффе один удобный импорт выглядит безобидно —
 * поэтому проверяет тест, а не ревью.
 */
const ALLOWED: Record<string, string[]> = {
  "@mapward/core": [],
  // Текст инструмента, который едет вместе с ним: не зависит ни от кого, и зависеть не от чего.
  "@mapward/docs": [],
  "@mapward/abstract-server": ["@mapward/core", "@mapward/docs"],
  // Типы дисплея-компонента (решение 0037): публикуются для чужих проектов, поэтому не знают
  // никого из своих; клиент берёт их, чтобы типы и то, что приходит в пропсах, не разъехались.
  "@mapward/display": [],
  "@mapward/abstract-react-client": ["@mapward/core", "@mapward/display"],
};

async function manifest(dir: string): Promise<{ name: string; deps: string[] }> {
  const raw = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
  };
  return { name: raw.name, deps: Object.keys(raw.dependencies ?? {}) };
}

test("packages depend in one direction only", async () => {
  const entries = await readdir("packages", { withFileTypes: true });
  const packages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => manifest(path.join("packages", entry.name))),
  );

  expect(packages.length).toBeGreaterThan(0);

  for (const pkg of packages) {
    const allowed = ALLOWED[pkg.name];
    expect(allowed, `нет правила для ${pkg.name}`).toBeDefined();
    const ours = pkg.deps.filter((dep) => dep.startsWith("@mapward/"));
    expect(ours.toSorted(), pkg.name).toEqual((allowed ?? []).toSorted());
  }
});

test("no package depends on an app", async () => {
  const apps = await readdir("apps", { withFileTypes: true });
  const appNames = await Promise.all(
    apps
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => (await manifest(path.join("apps", entry.name))).name),
  );

  const entries = await readdir("packages", { withFileTypes: true });
  const packages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => manifest(path.join("packages", entry.name))),
  );

  for (const pkg of packages) {
    expect(
      pkg.deps.filter((dep) => appNames.includes(dep)),
      pkg.name,
    ).toEqual([]);
  }
});
