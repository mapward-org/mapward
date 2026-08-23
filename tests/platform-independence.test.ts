import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * The rule from decision 8: `packages/` may not know where it runs. Apps bind the environment,
 * packages take it as an argument. A test guards it because a review will not: one convenient
 * `node:fs` import is exactly the change that looks harmless in a diff.
 *
 * oxlint has no working `no-restricted-imports` for this, so the check lives here.
 */
const FORBIDDEN = [
  /from\s+["']node:/,
  /require\(\s*["']node:/,
  /from\s+["'](fs|path|os|child_process|process|url|crypto)["']/,
  /from\s+["']vscode["']/,
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    }),
  );
  return found.flat();
}

test("packages do not import the platform they run on", async () => {
  const roots = await readdir("packages", { withFileTypes: true });
  const files = (
    await Promise.all(
      roots
        .filter((entry) => entry.isDirectory())
        .map((entry) => sourceFiles(path.join("packages", entry.name, "src"))),
    )
  ).flat();

  expect(files.length).toBeGreaterThan(0);

  const sources = await Promise.all(
    files.map(async (file) => [file, await readFile(file, "utf8")] as const),
  );
  const offenders = sources
    .filter(([, source]) => FORBIDDEN.some((pattern) => pattern.test(source)))
    .map(([file]) => file);

  expect(offenders).toEqual([]);
});
