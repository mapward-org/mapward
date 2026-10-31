import { afterAll, beforeAll, expect, test } from "vitest";
import { isReady, type Maybe } from "@mapward/vfs";
import { createVfs } from "./vfs.ts";

/**
 * Порты на node по-настоящему: байты и stat с диска, своя запись — через `touch`. Типов node у
 * пакета нет (`vfs.ts`), поэтому и тест берёт модули у процесса.
 */
type Fs = {
  mkdtemp(prefix: string): Promise<string>;
  rm(path: string, options: object): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
};
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(name: string): unknown };
};
const { mkdtemp, rm, writeFile } = process.getBuiltinModule("node:fs/promises") as Fs;
const { tmpdir } = process.getBuiltinModule("node:os") as { tmpdir(): string };

let dir = "";

beforeAll(async () => {
  dir = (await mkdtemp(`${tmpdir()}/mapward-vfs-`)).replaceAll("\\", "/");
  await writeFile(`${dir}/a.bin`, new Uint8Array([0, 255, 7]));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** Первое готовое значение, которое подходит. */
const until = <T>(
  stream: { subscribe(next: (value: Maybe<T>) => void): { unsubscribe(): void } },
  fits: (value: T) => boolean,
) =>
  new Promise<T>((resolve) => {
    let done = false;
    const subscription = stream.subscribe((value) => {
      if (done || !isReady(value) || !fits(value)) return;
      done = true;
      resolve(value);
      void Promise.resolve().then(() => subscription.unsubscribe());
    });
  });

test("createVfs: bytes$ отдаёт файл как есть, stat$ — размер, без файла — undefined", async () => {
  const vfs = createVfs(dir);
  const bytes = await until(vfs.bytes$(`${dir}/a.bin`), () => true);
  expect(bytes && [...bytes]).toEqual([0, 255, 7]);

  const stat = await until(vfs.stat$(`${dir}/a.bin`), () => true);
  expect(stat?.size).toBe(3);
  expect(stat?.mtimeMs).toBeGreaterThan(0);

  expect(await until(vfs.stat$(`${dir}/нет.bin`), () => true)).toBeUndefined();
  vfs.dispose();
});

test("createVfs: изменённые байты и новый размер приходят после touch", async () => {
  const vfs = createVfs(dir);
  const bytes$ = vfs.bytes$(`${dir}/a.bin`);
  const stat$ = vfs.stat$(`${dir}/a.bin`);
  const grown = until(stat$, (stat) => stat?.size === 4);
  const changed = until(bytes$, (bytes) => bytes?.length === 4);
  await until(stat$, () => true);

  await writeFile(`${dir}/a.bin`, new Uint8Array([1, 2, 3, 4]));
  await vfs.touch([`${dir}/a.bin`]);
  expect([...((await changed) ?? [])]).toEqual([1, 2, 3, 4]);
  expect((await grown)?.size).toBe(4);
  vfs.dispose();
});
