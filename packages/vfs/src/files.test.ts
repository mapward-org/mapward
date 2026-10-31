import { expect, test } from "vitest";
import { LiveFiles, type FileSource } from "./files.ts";
import { PENDING } from "./stream.ts";

/** Источник в памяти: сколько раз на путь подписались и кто слушает сейчас. */
function memory(texts: Record<string, string>) {
  const listeners = new Map<string, (text: string | undefined) => void>();
  let reads = 0;
  const source: FileSource = {
    file(path, next) {
      reads += 1;
      listeners.set(path, next);
      next(texts[path]);
      return () => listeners.delete(path);
    },
    list: (_path, next) => {
      next([]);
      return () => undefined;
    },
  };
  return { source, listeners, reads: () => reads };
}

test("файл читается один раз на всех читателей и отпускается без них", () => {
  const { source, listeners, reads } = memory({ "/a.json": '{"n":1}' });
  const files = new LiveFiles(source);
  const seen: unknown[] = [];
  const first = files.text$("/a.json").subscribe((value) => seen.push(value));
  const second = files.json$("/a.json").subscribe((value) => seen.push(value));

  expect(reads()).toBe(1);
  expect(seen).toEqual([PENDING, '{"n":1}', { n: 1 }]);

  listeners.get("/a.json")?.("не json");
  expect(seen.at(-1)).toBeUndefined();

  first.unsubscribe();
  second.unsubscribe();
  expect(listeners.size).toBe(0);
});

test("пока файл не пришёл, поток говорит PENDING", () => {
  const files = new LiveFiles({
    file: () => () => undefined,
    list: () => () => undefined,
  });
  const seen: unknown[] = [];
  files
    .text$("/late")
    .subscribe((value) => seen.push(value))
    .unsubscribe();
  expect(seen).toEqual([PENDING]);
});

test("bytes$: одинаковые байты новым массивом дальше не уходят; без умения источника — undefined", () => {
  let push: ((bytes: Uint8Array | undefined) => void) | undefined;
  const files = new LiveFiles({
    file: () => () => undefined,
    list: () => () => undefined,
    bytes: (_path, next) => {
      push = next;
      next(new Uint8Array([1, 2]));
      return () => undefined;
    },
  });
  const seen: unknown[] = [];
  const subscription = files.bytes$("/a.bin").subscribe((value) => seen.push(value));
  push?.(new Uint8Array([1, 2]));
  push?.(new Uint8Array([1, 3]));
  expect(seen).toEqual([PENDING, new Uint8Array([1, 2]), new Uint8Array([1, 3])]);
  subscription.unsubscribe();

  // Источник без stat: поток не висит в PENDING, а говорит «не знаю».
  const stats: unknown[] = [];
  files
    .stat$("/a.bin")
    .subscribe((value) => stats.push(value))
    .unsubscribe();
  expect(stats).toEqual([undefined]);
});
