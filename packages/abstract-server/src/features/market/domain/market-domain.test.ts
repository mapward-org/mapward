import { expect, test } from "vitest";
import { diffThree, pieceFiles, pieceTops, pluginFiles, relocateText } from "./package.ts";
import { archiveUrl, parseIndex, repoOf, searchEntries } from "./registry.ts";
import { untar } from "./tar.ts";

// Тесты сервера живут без окружения node, как и он сам: UTF-8 — через стандартные escape-функции.
const encoder = {
  encode: (text: string) =>
    Uint8Array.from(unescape(encodeURIComponent(text)), (char) => char.charCodeAt(0)),
};
const decode = (bytes: Uint8Array) => {
  try {
    return decodeURIComponent(escape(String.fromCharCode(...bytes)));
  } catch {
    return undefined;
  }
};

/** Заголовок tar: имя, размер восьмеричным, тип; контрольная сумма разбору не нужна. */
function entry(name: string, body: Uint8Array, type = "0"): Uint8Array {
  const header = new Uint8Array(512);
  header.set(encoder.encode(name).subarray(0, 100), 0);
  header.set(encoder.encode(`${body.length.toString(8).padStart(11, "0")}\0`), 124);
  header[156] = type.charCodeAt(0);
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
  padded.set(body);
  const out = new Uint8Array(512 + padded.length);
  out.set(header);
  out.set(padded, 512);
  return out;
}

function paxRecord(key: string, value: string): Uint8Array {
  const body = `${key}=${value}\n`;
  // Длина записи считает и себя: подбираем, пока число цифр не сойдётся.
  const size = (length: number) => encoder.encode(`${length} ${body}`).length;
  let length = encoder.encode(body).length + 2;
  while (size(length) !== length) length = size(length);
  return encoder.encode(`${length} ${body}`);
}

export function tarball(commit: string, files: Record<string, string | Uint8Array>): Uint8Array {
  const parts = [entry("pax_global_header", paxRecord("comment", commit), "g")];
  parts.push(entry("owner-repo-abc/", new Uint8Array(), "5"));
  for (const [path, content] of Object.entries(files)) {
    const body = typeof content === "string" ? encoder.encode(content) : content;
    const name = `owner-repo-abc/${path}`;
    if (encoder.encode(name).length > 100)
      parts.push(entry("././@PaxHeader", paxRecord("path", name), "x"));
    parts.push(entry(name, body));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

test("tar: коммит из pax-заголовка, верхняя папка срезана, двоичное — в skipped", () => {
  const long = `deep/${"очень-длинное-имя-".repeat(6)}.ts`;
  const archive = untar(
    tarball("0123abcd", {
      "index.ts": "export default {};",
      "README.md": "# привет",
      [long]: "x",
      "logo.png": new Uint8Array([0xff, 0xfe, 0x00, 0x80]),
    }),
    decode,
  );
  expect(archive.commit).toBe("0123abcd");
  expect(archive.files).toEqual({
    "index.ts": "export default {};",
    "README.md": "# привет",
    [long]: "x",
  });
  expect(archive.skipped).toEqual(["logo.png"]);
});

test("индекс: строки проверяются по одной, ошибки — с номером строки", () => {
  const { entries, errors } = parseIndex(
    JSON.stringify([
      { name: "graph", description: "граф кода", repo: "https://github.com/a/graph" },
      { name: "Bad Name", description: "", repo: "gitlab.com/x" },
      { name: "graph", description: "дубль", repo: "a/b", branch: "dev" },
    ]),
    "plugin",
  );
  expect(entries).toEqual([
    { kind: "plugin", name: "graph", description: "граф кода", repo: "a/graph", branch: "main" },
  ]);
  expect(errors).toHaveLength(2);
  expect(errors[0]).toMatch(/^plugins\.json\[1\]: name .*description .*repo/);
  expect(errors[1]).toMatch(/^plugins\.json\[2\]: name graph уже занято/);
  expect(parseIndex("{", "map").errors[0]).toMatch(/^maps\.json не json/);
});

test("репозиторий — владелец/имя или ссылка на GitHub", () => {
  expect(repoOf("a/b")).toBe("a/b");
  expect(repoOf("https://github.com/a/b.git")).toBe("a/b");
  expect(repoOf("https://gitlab.com/a/b")).toBeUndefined();
  expect(archiveUrl("a/b", { branch: "main" })).toBe(
    "https://codeload.github.com/a/b/tar.gz/refs/heads/main",
  );
  expect(archiveUrl("a/b", { commit: "abc" })).toBe("https://codeload.github.com/a/b/tar.gz/abc");
});

test("поиск: совпадение в имени выше, чем в описании; пустой запрос — всё", () => {
  const entries = parseIndex(
    JSON.stringify([
      { name: "deps", description: "граф зависимостей пакетов", repo: "a/deps" },
      { name: "graph", description: "холст", repo: "a/graph" },
      { name: "todo", description: "задачи", repo: "a/todo" },
    ]),
    "plugin",
  ).entries;
  expect(searchEntries(entries, "граф graph").map((one) => one.name)).toEqual(["graph", "deps"]);
  expect(searchEntries(entries, "")).toHaveLength(3);
});

test("плагин — только с index.* в корне; служебное git и node_modules не едут", () => {
  expect(pluginFiles({ "src/index.ts": "" })).toHaveProperty("error");
  expect(
    pluginFiles({
      "index.ts": "1",
      ".github/workflows/ci.yml": "x",
      "node_modules/a/index.js": "x",
      ".market.json": "{}",
    }),
  ).toEqual({ files: { "index.ts": "1" } });
});

test("кусок карты: адреса своих объектов переезжают под родителя, чужие остаются", () => {
  const files = {
    "service/_index.json": JSON.stringify({
      name: "Сервис",
      extends: "mapward://prototypes/base",
      props: { docs: "${{ mapward://service#props.path }}", sub: "mapward://service/api" },
    }),
    "service/_metrics/files/config.json": JSON.stringify({
      component: "${{ mapward:// }}/_plugins/views/list.tsx",
    }),
    "service/_metrics/files/view.tsx": "mapward://service",
    "service/_directives/2026-01-01-x.md": "история",
    "services-extra/_index.json": "{}",
    "_plugins/views/index.ts": "",
    "README.md": "",
  };
  const tops = pieceTops(files);
  expect(tops).toEqual(["service", "services-extra"]);
  const moved = pieceFiles(files, "service", tops, "mapward://apps");
  expect(Object.keys(moved).toSorted()).toEqual([
    "_index.json",
    "_metrics/files/config.json",
    "_metrics/files/view.tsx",
  ]);
  expect(JSON.parse(moved["_index.json"] ?? "")).toEqual({
    name: "Сервис",
    extends: "mapward://prototypes/base",
    props: { docs: "${{ mapward://apps/service#props.path }}", sub: "mapward://apps/service/api" },
  });
  expect(moved["_metrics/files/config.json"]).toContain("${{ mapward:// }}/_plugins/views");
  // `services-extra` — свой объект, но `mapward://service` не его префикс.
  expect(relocateText('"mapward://services-extra"', tops, "mapward://apps")).toBe(
    '"mapward://apps/services-extra"',
  );
  expect(relocateText('"mapward://service"', tops, "mapward://")).toBe('"mapward://service"');
});

test("три состояния: кто что поменял", () => {
  expect(
    diffThree(
      { a: "1", b: "1", c: "1", d: "1" },
      { a: "2", b: "1", c: "1", e: "1" },
      { a: "1", b: "3", c: "1", d: "1" },
    ),
  ).toEqual([
    { path: "a", author: "changed" },
    { path: "b", local: "changed" },
    { path: "d", author: "removed" },
    { path: "e", author: "added" },
  ]);
});
