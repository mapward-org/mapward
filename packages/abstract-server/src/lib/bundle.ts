import type * as Esbuild from "esbuild-wasm/esm/browser.js";
import type { BundlerPort, FileReader } from "../ports/index.ts";
import { dirname, join, normalize } from "./path.ts";

/**
 * Сборка esbuild в WebAssembly по файлам из порта — общая у дисплея-компонента (решение 0037) и
 * у плагина. Файлы читаются портом, а не файловой системой esbuild: так сборка одинаково
 * работает в расширении и в cli, а список прочитанного получается сам — по нему потом и следят.
 */

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json", ".css"];

const LOADERS: Record<string, Esbuild.Loader> = {
  ".tsx": "tsx",
  ".ts": "ts",
  ".jsx": "jsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".json": "json",
};

export const extension = (path: string) => /\.[^./]+$/.exec(path)?.[0] ?? "";
export const isCode = (path: string) =>
  LOADERS[extension(path)] !== undefined && extension(path) !== ".json";

/** Модули node: сборка плагина их не вкладывает, их даёт процесс. */
const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "fs/promises",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

/**
 * esbuild в WebAssembly поднимается один раз на процесс: инициализация — это компиляция
 * мегабайт `.wasm`, и второй `initialize` он и сам не разрешает.
 */
let esbuild: Promise<typeof Esbuild> | undefined;

export function loadEsbuild(bundler: BundlerPort): Promise<typeof Esbuild> {
  esbuild ??= (async () => {
    // Браузерная сборка esbuild ищет `self`, а у node его нет. Сборка эта — та же, что для
    // воркера, только без воркера: `self` для неё и есть глобальный объект.
    const global = globalThis as { self?: unknown };
    global.self ??= globalThis;
    const api = await import("esbuild-wasm/esm/browser.js");
    // `WebAssembly` есть и в node, и в браузере, но типов среды у сервера нет — решение 0014.
    const wasm = (
      globalThis as unknown as { WebAssembly: { compile(bytes: Uint8Array): Promise<never> } }
    ).WebAssembly;
    const wasmModule = await wasm.compile(await bundler.wasm());
    await api.initialize({ wasmModule, worker: false });
    return api;
  })().catch((error: unknown) => {
    esbuild = undefined;
    throw error;
  });
  return esbuild;
}

/** Где искать пакеты: от папки импортирующего вверх, потом корень проекта (решение 0037). */
function packageDirs(from: string, fallback: string): string[] {
  const dirs: string[] = [];
  let dir = from;
  for (;;) {
    if (!dir.endsWith("/node_modules")) dirs.push(join(dir, "node_modules"));
    const parent = dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  const last = join(fallback, "node_modules");
  if (!dirs.includes(last)) dirs.push(last);
  return dirs;
}

const splitPackage = (spec: string): { name: string; sub: string } => {
  const parts = spec.split("/");
  const size = spec.startsWith("@") ? 2 : 1;
  return { name: parts.slice(0, size).join("/"), sub: parts.slice(size).join("/") };
};

/** `exports` пакета: строка, условия или карта подпутей — берётся первое, что подходит. */
function pickExport(value: unknown, conditions: string[]): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickExport(item, conditions);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const condition of conditions) {
    if (condition in record) {
      const found = pickExport(record[condition], conditions);
      if (found) return found;
    }
  }
  return undefined;
}

function exportFor(exports: unknown, sub: string, conditions: string[]): string | undefined {
  const wanted = sub ? `./${sub}` : ".";
  if (typeof exports === "string" || Array.isArray(exports)) {
    return wanted === "." ? pickExport(exports, conditions) : undefined;
  }
  if (typeof exports !== "object" || exports === null) return undefined;
  const record = exports as Record<string, unknown>;
  const keyed = Object.keys(record).some((key) => key.startsWith("."));
  if (!keyed) return wanted === "." ? pickExport(record, conditions) : undefined;
  if (wanted in record) return pickExport(record[wanted], conditions);
  // Подпуть со звёздочкой: `"./*": "./dist/*.js"`.
  for (const [pattern, target] of Object.entries(record)) {
    const star = pattern.indexOf("*");
    if (star === -1) continue;
    const head = pattern.slice(0, star);
    const tail = pattern.slice(star + 1);
    if (wanted.startsWith(head) && wanted.endsWith(tail)) {
      const middle = wanted.slice(head.length, wanted.length - tail.length);
      return pickExport(target, conditions)?.replaceAll("*", middle);
    }
  }
  return undefined;
}

export type BundleInput = {
  /** Абсолютный путь к точке входа. */
  entry: string;
  /** Корень проекта: запасной путь к `node_modules`, когда поиск вверх ничего не дал. */
  basePath: string;
  /** `browser` — компонент в вебвью, `node` — процесс плагина. */
  platform: "browser" | "node";
  /** Что сборка не вкладывает: это даёт среда, где модуль выполнится. */
  provided: ReadonlySet<string>;
  /** Модули текстом: так в сборку плагина едет рантайм `@mapward/plugin`. */
  virtual?: Readonly<Record<string, { contents: string; loader: Esbuild.Loader }>>;
  /** Css из импортов: дисплей кладёт его рядом со своим, плагину он ни к чему. */
  onCss?: (text: string) => void;
};

export type BundleOutput =
  | { code: string; contents: Map<string, string | undefined> }
  | { errors: string[]; contents: Map<string, string | undefined> };

export async function bundle(
  files: FileReader,
  bundler: BundlerPort,
  input: BundleInput,
): Promise<BundleOutput> {
  const contents = new Map<string, string | undefined>();
  const conditions =
    input.platform === "node"
      ? ["node", "import", "module", "default", "require"]
      : ["browser", "import", "module", "default", "require"];
  const read = async (path: string): Promise<string | undefined> => {
    if (!contents.has(path)) contents.set(path, await files.read(path));
    return contents.get(path);
  };
  // Пакеты pnpm лежат по ссылкам, и свои зависимости они находят от настоящего пути.
  const real = async (path: string) =>
    files.realpath ? ((await files.realpath(path)) ?? path).replaceAll("\\", "/") : path;

  const asFile = async (path: string): Promise<string | undefined> => {
    const base = normalize(path);
    const tries = [
      base,
      ...EXTENSIONS.map((ext) => `${base}${ext}`),
      ...EXTENSIONS.map((ext) => `${base}/index${ext}`),
    ];
    for (const candidate of tries) {
      // oxlint-disable-next-line no-await-in-loop
      if ((await read(candidate)) !== undefined) return real(candidate);
    }
    return undefined;
  };

  const asPackage = async (spec: string, from: string): Promise<string | undefined> => {
    const { name, sub } = splitPackage(spec);
    for (const dir of packageDirs(from, input.basePath)) {
      const root = join(dir, name);
      // oxlint-disable-next-line no-await-in-loop
      const manifest = await read(join(root, "package.json"));
      if (manifest === undefined) continue;
      let pkg: Record<string, unknown> = {};
      try {
        pkg = JSON.parse(manifest) as Record<string, unknown>;
      } catch {
        // битый package.json — пакет ищется дальше как папка
      }
      const exported =
        pkg.exports === undefined ? undefined : exportFor(pkg.exports, sub, conditions);
      if (exported) return asFile(join(root, exported));
      if (sub) return asFile(join(root, sub));
      const main =
        (typeof pkg.module === "string" && pkg.module) ||
        (typeof pkg.main === "string" && pkg.main) ||
        "index.js";
      return asFile(join(root, main));
    }
    return undefined;
  };

  const external = (spec: string) =>
    input.provided.has(spec) ||
    (input.platform === "node" && (spec.startsWith("node:") || NODE_BUILTINS.has(spec)));

  const plugin: Esbuild.Plugin = {
    name: "mapward-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (input.virtual?.[args.path]) return { path: args.path, namespace: "mapward-virtual" };
        if (external(args.path)) return { path: args.path, external: true };
        const from = args.importer ? dirname(args.importer) : dirname(input.entry);
        const spec = args.path.replaceAll("\\", "/");
        const relative = spec.startsWith(".") || spec.startsWith("/") || /^[a-zA-Z]:\//.test(spec);
        const found = relative
          ? await asFile(spec.startsWith(".") ? join(from, spec) : spec)
          : await asPackage(spec, from);
        if (!found) {
          return {
            errors: [
              {
                text: relative
                  ? `не найден файл ${spec}`
                  : `не найден пакет ${spec}: искали node_modules от ${from} вверх и в ${input.basePath}` +
                    " — если он в dependencies плагина, поставьте их: npm install --omit=dev в папке плагина",
              },
            ],
          };
        }
        return { path: found, namespace: "mapward" };
      });

      build.onLoad({ filter: /.*/, namespace: "mapward-virtual" }, (args) => {
        const module = input.virtual?.[args.path];
        return { contents: module?.contents ?? "", loader: module?.loader ?? "js" };
      });

      build.onLoad({ filter: /.*/, namespace: "mapward" }, async (args) => {
        const text = (await read(args.path)) ?? "";
        const ext = extension(args.path);
        if (ext === ".css") {
          input.onCss?.(text);
          return { contents: "", loader: "js" };
        }
        return { contents: text, loader: LOADERS[ext] ?? "js", resolveDir: dirname(args.path) };
      });
    },
  };

  let api: typeof Esbuild;
  try {
    api = await loadEsbuild(bundler);
  } catch (error) {
    return { errors: [`esbuild не поднялся: ${message(error)}`], contents };
  }

  try {
    const result = await api.build({
      entryPoints: [input.entry],
      bundle: true,
      write: false,
      format: "cjs",
      platform: input.platform,
      target: input.platform === "node" ? "node22" : "es2022",
      jsx: "automatic",
      // Строки карты русские: без этого они уезжают `з…`, и код не прочитать.
      charset: "utf8",
      logLevel: "silent",
      ...(input.platform === "browser"
        ? { define: { "process.env.NODE_ENV": '"production"' } }
        : {}),
      plugins: [plugin],
    });
    return { code: result.outputFiles[0]?.text ?? "", contents };
  } catch (error) {
    return { errors: buildErrors(error), contents };
  }
}

/** Следят за своим, а не за пакетами: `node_modules` меняется установкой, а не правкой. */
export const watchedOf = (contents: Map<string, string | undefined>, entry: string): string[] => {
  const read = [...contents.entries()]
    .filter(([path, text]) => text !== undefined && !path.includes("/node_modules/"))
    .map(([path]) => path);
  return read.includes(entry) ? read : [entry, ...read];
};

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Ошибка сборки строкой на сообщение: файл, строка и столбец, как у редактора. */
function buildErrors(error: unknown): string[] {
  const errors = (error as { errors?: Esbuild.Message[] }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return [message(error)];
  return errors.map((item) => {
    const where = item.location
      ? `${item.location.file}:${item.location.line}:${item.location.column + 1}: `
      : "";
    return `${where}${item.text}`;
  });
}
