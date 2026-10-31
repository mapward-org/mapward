import { expect, test } from "vitest";
import type {
  FileEntry,
  FileReader,
  FileWriter,
  PackagesPort,
  TrustPort,
} from "../../../../ports/index.ts";
import { InstallPlugin } from "./install-plugin.ts";

const REF = { mapPath: "/repo/map", basePath: "/repo", name: "карта" };

const SOURCES = {
  hello: { "index.ts": "export default {};", "lib/greet.ts": "export const greet = 1;" },
};

/** Диск в памяти: папки видны по путям файлов под ними, как их видит `list`. */
function disk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const port: FileReader & FileWriter = {
    read: async (path) => files.get(path),
    list: async (dir) => {
      const entries = new Map<string, FileEntry>();
      for (const path of files.keys()) {
        if (!path.startsWith(`${dir}/`)) continue;
        const [name = "", ...rest] = path.slice(dir.length + 1).split("/");
        entries.set(name, { name, isDirectory: rest.length > 0 });
      }
      return [...entries.values()];
    },
    write: async (path, text) => {
      files.set(path, text);
    },
    remove: async (path) => {
      files.delete(path);
    },
  };
  return { files, port };
}

function trust() {
  const granted: string[] = [];
  const port: TrustPort = {
    allow: async ({ plugin }) => granted.includes(plugin),
    grant: async ({ plugin }) => {
      granted.push(plugin);
    },
  };
  return { granted, port };
}

test("копирует исходники в _plugins/<имя> и помечает плагин доверенным", async () => {
  const { files, port } = disk();
  const trusted = trust();
  const install = new InstallPlugin(port, trusted.port, SOURCES);

  const result = await install.run(REF, "hello");

  expect(result).toEqual({
    ok: true,
    plugin: "/repo/map/_plugins/hello",
    files: ["/repo/map/_plugins/hello/lib/greet.ts", "/repo/map/_plugins/hello/index.ts"],
  });
  expect(Object.fromEntries(files)).toEqual({
    "/repo/map/_plugins/hello/index.ts": "export default {};",
    "/repo/map/_plugins/hello/lib/greet.ts": "export const greet = 1;",
  });
  expect(trusted.granted).toEqual(["/repo/map/_plugins/hello"]);
});

test("названная папка — от корня карты; мимо карты — отказ", async () => {
  const { files, port } = disk();
  const install = new InstallPlugin(port, undefined, SOURCES);

  expect(await install.run(REF, "hello", "tools/hi")).toMatchObject({
    ok: true,
    plugin: "/repo/map/tools/hi",
  });
  expect(files.has("/repo/map/tools/hi/index.ts")).toBe(true);
  expect(await install.run(REF, "hello", "../outside")).toMatchObject({ ok: false });
  expect(await install.run(REF, "hello", "/elsewhere/hello")).toMatchObject({ ok: false });
});

test("существующую папку не перезаписывает никогда", async () => {
  const { files, port } = disk({ "/repo/map/_plugins/hello/index.ts": "// правка человека" });
  const trusted = trust();
  const install = new InstallPlugin(port, trusted.port, SOURCES);

  const result = await install.run(REF, "hello");

  expect(result.ok).toBe(false);
  expect(result).toMatchObject({ error: expect.stringMatching(/уже есть/) });
  expect(files.get("/repo/map/_plugins/hello/index.ts")).toBe("// правка человека");
  expect(files.has("/repo/map/_plugins/hello/lib/greet.ts")).toBe(false);
  expect(trusted.granted).toEqual([]);
});

test("неизвестное имя — отказ с перечнем встроенных", async () => {
  const install = new InstallPlugin(disk().port, undefined, SOURCES);

  expect(await install.run(REF, "nope")).toEqual({
    ok: false,
    error: "встроенного плагина nope нет; есть: hello",
  });
});

test("restore: доставляет встроенный только по его месту и только когда папки нет", async () => {
  const { files, port } = disk();
  const install = new InstallPlugin(port, undefined, SOURCES);

  expect(await install.restore(REF, "/repo/map/tools/hello")).toBe(false);
  expect(await install.restore(REF, "/repo/map/_plugins/other")).toBe(false);
  expect(files.size).toBe(0);

  expect(await install.restore(REF, "/repo/map/_plugins/hello")).toBe(true);
  expect(files.has("/repo/map/_plugins/hello/index.ts")).toBe(true);

  files.set("/repo/map/_plugins/hello/index.ts", "// правка");
  expect(await install.restore(REF, "/repo/map/_plugins/hello")).toBe(false);
  expect(files.get("/repo/map/_plugins/hello/index.ts")).toBe("// правка");
});

const CANVAS = {
  canvas: {
    "index.ts": "export default {};",
    "package.json": JSON.stringify({ dependencies: { "@xyflow/react": "^12.10.0", rxjs: "^7" } }),
  },
};

/** Установка зависимостей без сети: команда подставная, она только запоминает папку. */
function packages(fail?: string) {
  const dirs: string[] = [];
  const port: PackagesPort = {
    install: async (dir) => {
      dirs.push(dir);
      if (fail) throw new Error(fail);
    },
  };
  return { dirs, port };
}

test("зависимости из package.json ставятся в папку плагина после копирования", async () => {
  const { files, port } = disk();
  const npm = packages();
  const install = new InstallPlugin(port, undefined, CANVAS, npm.port);

  expect(await install.run(REF, "canvas")).toEqual({
    ok: true,
    plugin: "/repo/map/_plugins/canvas",
    files: ["/repo/map/_plugins/canvas/package.json", "/repo/map/_plugins/canvas/index.ts"],
    dependencies: ["@xyflow/react", "rxjs"],
  });
  expect(npm.dirs).toEqual(["/repo/map/_plugins/canvas"]);
  // Ставят после копирования: npm читает package.json из папки.
  expect(files.has("/repo/map/_plugins/canvas/package.json")).toBe(true);

  // Без зависимостей npm не зовут вовсе.
  const plain = packages();
  await new InstallPlugin(disk().port, undefined, SOURCES, plain.port).run(REF, "hello");
  expect(plain.dirs).toEqual([]);
});

test("без сети — понятный отказ с командой; копия остаётся и доверена", async () => {
  const { files, port } = disk();
  const trusted = trust();
  const npm = packages("npm error code ENOTFOUND\nnpm error network request failed");
  const install = new InstallPlugin(port, trusted.port, CANVAS, npm.port);

  const result = await install.run(REF, "canvas");

  expect(result.ok).toBe(false);
  const error = (result as { error: string }).error;
  expect(error).toMatch(/нет сети/);
  expect(error).toContain('cd "/repo/map/_plugins/canvas" && npm install --omit=dev');
  expect(files.has("/repo/map/_plugins/canvas/index.ts")).toBe(true);
  expect(trusted.granted).toEqual(["/repo/map/_plugins/canvas"]);
});

test("хост, который пакеты не ставит, просит поставить их самому", async () => {
  const install = new InstallPlugin(disk().port, undefined, CANVAS);
  expect(await install.run(REF, "canvas")).toMatchObject({
    ok: false,
    error: expect.stringMatching(/не ставит.*npm install --omit=dev --omit=peer/),
  });
});
