import { expect, test } from "vitest";
import { DiskFiles } from "./disk.ts";
import type { FileEntry, FileStat } from "./ports.ts";

/** Чтения — промисы: дать им дойти, не заводя таймеров. */
const flush = async () => {
  for (let step = 0; step < 20; step += 1) await Promise.resolve();
};

/** Диск, вотчер, таймеры и часы в памяти: время идёт, только когда его двигает тест. */
function world(
  texts: Record<string, string>,
  blobs: Record<string, Uint8Array> = {},
  stats: Record<string, FileStat> = {},
) {
  let now = 0;
  const queue: { at: number; run: () => void }[] = [];
  let onChange: ((path: string) => void) | undefined;
  const reads: string[] = [];

  const disk = new DiskFiles(
    "D:/root",
    {
      read: async (path) => {
        reads.push(path);
        return texts[path];
      },
      // Каждое чтение — новый массив, как с диска: одинаковость решает сравнение, а не тождество.
      bytes: async (path) => {
        reads.push(path);
        const found = blobs[path];
        return found && new Uint8Array(found);
      },
      stat: async (path) => {
        const found = stats[path];
        return found && { ...found };
      },
      list: async (path): Promise<FileEntry[]> =>
        Object.keys(texts)
          .filter(
            (file) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/"),
          )
          .map((file) => ({ name: file.slice(path.length + 1), isDirectory: false })),
    },
    {
      watch: (_root, next) => {
        onChange = next;
        return () => {
          onChange = undefined;
        };
      },
    },
    {
      after: (ms, run) => {
        queue.push({ at: now + ms, run });
        return () => undefined;
      },
    },
    { now: () => new Date(now).toISOString() },
  );

  const advance = async (ms: number) => {
    now += ms;
    for (const entry of queue.filter((one) => one.at <= now)) {
      queue.splice(queue.indexOf(entry), 1);
      entry.run();
    }
    await flush();
  };
  return {
    disk,
    texts,
    blobs,
    stats,
    reads,
    advance,
    change: (path: string) => onChange?.(path),
    watching: () => onChange !== undefined,
  };
}

const settle = () => flush();

test("изменение от вотчера доходит пачкой по тишине, одинаковое не повторяется", async () => {
  const w = world({ "D:/root/a.md": "раз" });
  const seen: (string | undefined)[] = [];
  const stop = w.disk.file("D:/root/a.md", (text) => seen.push(text));
  await settle();
  expect(seen).toEqual(["раз"]);
  expect(w.watching()).toBe(true);

  w.texts["D:/root/a.md"] = "два";
  // Вотчер редактора присылает обратные слэши и маленькую букву диска.
  w.change("d:\\root\\a.md");
  w.change("D:/root/a.md");
  await w.advance(100);
  w.change("D:/root/a.md");
  await w.advance(100);
  expect(seen).toEqual(["раз", "два"]);

  stop();
  expect(w.watching()).toBe(false);
});

test("папка перечитывается, когда изменилось под ней; touch — без вотчера", async () => {
  const w = world({ "D:/root/a.md": "" });
  const lists: string[][] = [];
  const stop = w.disk.list("D:/root", (entries) => lists.push(entries.map((one) => one.name)));
  await settle();

  w.texts["D:/root/b.md"] = "";
  await w.disk.touch(["D:/root/b.md"]);
  expect(lists).toEqual([["a.md"], ["a.md", "b.md"]]);
  expect(w.disk.holds("d:\\root\\b.md")).toBe(true);
  expect(w.disk.holds("D:/other")).toBe(false);
  stop();
});

test("байты: одинаковые по содержимому не уходят, изменённые уходят, touch перечитывает", async () => {
  const w = world({}, { "D:/root/logo.png": new Uint8Array([1, 2, 3]) });
  const seen: (number[] | undefined)[] = [];
  const stop = w.disk.bytes("D:/root/logo.png", (bytes) => seen.push(bytes && [...bytes]));
  await settle();
  expect(seen).toEqual([[1, 2, 3]]);

  // Файл переписан тем же содержимым — дальше не уходит.
  w.change("D:/root/logo.png");
  await w.advance(100);
  expect(seen).toEqual([[1, 2, 3]]);

  // Та же длина, другой байт — уходит.
  w.blobs["D:/root/logo.png"] = new Uint8Array([1, 2, 4]);
  w.change("D:/root/logo.png");
  await w.advance(100);
  expect(seen).toEqual([
    [1, 2, 3],
    [1, 2, 4],
  ]);

  // Своя запись — без вотчера.
  delete w.blobs["D:/root/logo.png"];
  await w.disk.touch(["D:/root/logo.png"]);
  expect(seen.at(-1)).toBeUndefined();
  stop();
  expect(w.watching()).toBe(false);
});

test("stat: смена размера или времени уходит, тот же stat — нет", async () => {
  const w = world({}, {}, { "D:/root/.git/index": { size: 10, mtimeMs: 1 } });
  const seen: (FileStat | undefined)[] = [];
  const stop = w.disk.stat("D:/root/.git/index", (stat) => seen.push(stat));
  await settle();
  expect(seen).toEqual([{ size: 10, mtimeMs: 1 }]);

  w.change("D:/root/.git/index");
  await w.advance(100);
  expect(seen).toHaveLength(1);

  // Коммит переписал индекс того же размера — время другое.
  w.stats["D:/root/.git/index"] = { size: 10, mtimeMs: 2 };
  w.change("D:/root/.git/index");
  await w.advance(100);
  w.stats["D:/root/.git/index"] = { size: 12, mtimeMs: 2 };
  await w.disk.touch(["D:/root/.git/index"]);
  expect(seen).toEqual([
    { size: 10, mtimeMs: 1 },
    { size: 10, mtimeMs: 2 },
    { size: 12, mtimeMs: 2 },
  ]);
  // stat не читает содержимое.
  expect(w.reads).toEqual([]);
  stop();
});

test("reload перечитывает и байты, и stat", async () => {
  const w = world(
    {},
    { "D:/root/a.bin": new Uint8Array([0]) },
    { "D:/root/a.bin": { size: 1, mtimeMs: 1 } },
  );
  const bytes: number[][] = [];
  const stats: number[] = [];
  const stopBytes = w.disk.bytes("D:/root/a.bin", (value) => bytes.push([...(value ?? [])]));
  const stopStat = w.disk.stat("D:/root/a.bin", (value) => stats.push(value?.size ?? -1));
  await settle();

  w.blobs["D:/root/a.bin"] = new Uint8Array([0, 0]);
  w.stats["D:/root/a.bin"] = { size: 2, mtimeMs: 2 };
  await w.disk.reload();
  expect(bytes).toEqual([[0], [0, 0]]);
  expect(stats).toEqual([1, 2]);
  stopBytes();
  stopStat();
});
