import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

/**
 * Разметка живёт в пакете клиента (решение 0014), а tailwind сам ищет классы только там, где
 * лежит входной css. Без `@source` на пакет он не находит ни одного класса, сборка проходит
 * зелёной, а сайдбар открывается голым текстом — поэтому это стережёт тест, а не внимание.
 */
test("tailwind scans the client package", async () => {
  const css = await readFile("apps/vscode-extension/src/apps/webview/index.css", "utf8");
  const sources = [...css.matchAll(/@source\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

  expect(sources.some((source) => source.includes("abstract-react-client"))).toBe(true);
});
