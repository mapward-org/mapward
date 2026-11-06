import { expect, test } from "vitest";
import type { LogLine } from "@mapward/core";
import type {
  FileEntry,
  FileMover,
  FileReader,
  FileWriter,
  TimersPort,
} from "../../../ports/index.ts";
import { MAX_BYTES } from "../domain/log-file.ts";
import { LogStore } from "./log-store.ts";

const MAP = "/map";

/** Диск в памяти с дозаписью и переносом — как у приложений. */
function disk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const port: FileReader & FileWriter & FileMover = {
    read: async (path) => files.get(path),
    list: async (path) => {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0] ?? "");
      }
      return [...names].map((name): FileEntry => ({ name, isDirectory: false }));
    },
    write: async (path, text) => {
      files.set(path, text);
    },
    append: async (path, text) => {
      files.set(path, (files.get(path) ?? "") + text);
    },
    remove: async (path) => {
      files.delete(path);
    },
    move: async (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`нет ${from}`);
      files.set(to, text);
      files.delete(from);
    },
  };
  return { port, files };
}

/** Таймеры по кнопке: пачка уходит на диск, когда тест скажет. */
function timers() {
  const pending: (() => void)[] = [];
  const port: TimersPort = {
    every: () => () => {},
    after: (_ms, run) => {
      pending.push(run);
      return () => {};
    },
  };
  return { port, fire: () => pending.splice(0).forEach((run) => run()) };
}

const line = (file: string, extra: Partial<LogLine> = {}): LogLine => ({
  at: "2026-11-02T10:00:00.000Z",
  kind: "log",
  file,
  ...extra,
});

test("строки ложатся пачкой в файл плагина JSON-ом по строке; .mapward прячется от git", async () => {
  const { port, files } = disk();
  const time = timers();
  const logs = new LogStore(port, time.port);

  logs.write(MAP, line("shell", { trace: "t1", text: "раз" }));
  logs.write(MAP, line("shell", { trace: "t1", text: "два" }));
  logs.write(MAP, line("mapward", { kind: "trace-start", trace: "t1" }));
  // До пачки на диске ничего: строка на каждый вызов диска не стоит.
  expect(files.size).toBe(0);
  time.fire();
  await logs.flush(MAP);

  const shell = files.get("/map/.mapward/logs/shell.log") ?? "";
  // Имя файла в строке не повторяется — оно и есть файл.
  expect(
    shell
      .trim()
      .split("\n")
      .map((text) => JSON.parse(text) as unknown),
  ).toEqual([
    { at: "2026-11-02T10:00:00.000Z", kind: "log", trace: "t1", text: "раз" },
    { at: "2026-11-02T10:00:00.000Z", kind: "log", trace: "t1", text: "два" },
  ]);
  expect(files.get("/map/.mapward/logs/mapward.log")).toContain('"trace-start"');
  expect(files.get("/map/.mapward/.gitignore")).toBe("*\n");
});

test("файл больше предела становится .1, прежний .1 уходит", async () => {
  const big = `${JSON.stringify({ at: "x", kind: "log", text: "a".repeat(MAX_BYTES) })}\n`;
  const { port, files } = disk({
    "/map/.mapward/logs/shell.log": big,
    "/map/.mapward/logs/shell.log.1": "старое\n",
  });
  const logs = new LogStore(port, timers().port);

  logs.write(MAP, line("shell", { text: "свежее" }));
  await logs.flush(MAP);

  expect(files.get("/map/.mapward/logs/shell.log.1")).toBe(big);
  expect(files.get("/map/.mapward/logs/shell.log")).toContain("свежее");
});

test("чтение по фильтру — из всех файлов, по времени; битая строка пропускается", async () => {
  const { port } = disk({
    "/map/.mapward/logs/shell.log": [
      JSON.stringify({
        at: "2026-11-02T10:00:02Z",
        kind: "out",
        trace: "t1",
        object: "o",
        text: "б",
      }),
      "{недописан",
      JSON.stringify({
        at: "2026-11-02T10:00:03Z",
        kind: "out",
        trace: "t2",
        object: "o",
        text: "в",
      }),
    ].join("\n"),
    "/map/.mapward/logs/mapward.log.1": JSON.stringify({
      at: "2026-11-02T10:00:01Z",
      kind: "trace-start",
      trace: "t1",
      object: "o",
    }),
  });
  const logs = new LogStore(port, timers().port);

  const t1 = await logs.read(MAP, { trace: "t1" });
  expect(t1.map((entry) => [entry.file, entry.kind])).toEqual([
    ["mapward", "trace-start"],
    ["shell", "out"],
  ]);
  expect((await logs.read(MAP, { file: "shell" })).map((entry) => entry.text)).toEqual(["б", "в"]);
  expect(await logs.read(MAP, { object: "o" }, 1)).toHaveLength(1);
});

test("поток отдаёт окно сразу и заново на пачку, где нашлось подходящее", async () => {
  const { port } = disk();
  const time = timers();
  const logs = new LogStore(port, time.port);
  const seen: string[][] = [];
  const subscription = logs
    .watch(MAP, { trace: "t1" })
    .subscribe((lines) => seen.push(lines.map((entry) => entry.text ?? "")));
  // Первое окно — после чтения диска: то же чтение ждём и здесь.
  await logs.read(MAP, { trace: "t1" });

  logs.write(MAP, line("shell", { trace: "t1", text: "раз" }));
  time.fire();
  // Чужой трейс окна не меняет — и ничего не шлётся.
  logs.write(MAP, line("shell", { trace: "t2", text: "мимо" }));
  time.fire();
  logs.write(MAP, line("agent", { trace: "t1", text: "два" }));
  time.fire();
  subscription.unsubscribe();

  expect(seen).toEqual([[], ["раз"], ["раз", "два"]]);
});
