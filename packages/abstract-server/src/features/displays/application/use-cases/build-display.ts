// Приложения проверяют сервер по исходникам, и объявление `?raw` доходит до них только так.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../../../../raw-modules.ts" />
import type * as Esbuild from "esbuild-wasm/esm/browser.js";
import { compile } from "tailwindcss";
import type { DisplayBuild } from "@mapward/core";
import type { BundlerPort, ClockPort, FileReader } from "../../../../ports/index.ts";
import { dirname, join, normalize } from "../../../../lib/path.ts";
import { candidates } from "../../domain/component.ts";
// Стили tailwind едут текстом внутри сервера: у установленного расширения `node_modules` нет.
import themeCss from "tailwindcss/theme.css?raw";
import utilitiesCss from "tailwindcss/utilities.css?raw";

/**
 * Сборка дисплея-компонента — решение 0037: `.tsx` метрики в CommonJS-модуль и css на его
 * классы. Файлы читаются портом, а не файловой системой esbuild: так сборка одинаково работает
 * в расширении и в cli, а список прочитанного получается сам — по нему потом и следят.
 */

/** Это отдаёт клиент: две копии React на странице ломают хуки. */
const PROVIDED = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@mapward/display",
]);

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

const extension = (path: string) => /\.[^./]+$/.exec(path)?.[0] ?? "";

/**
 * esbuild в WebAssembly поднимается один раз на процесс: инициализация — это компиляция
 * мегабайт `.wasm`, и второй `initialize` он и сам не разрешает.
 */
let esbuild: Promise<typeof Esbuild> | undefined;

function loadEsbuild(bundler: BundlerPort): Promise<typeof Esbuild> {
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

const CONDITIONS = ["browser", "import", "module", "default", "require"];

/** `exports` пакета: строка, условия или карта подпутей — берётся первое, что подходит. */
function pickExport(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickExport(item);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const condition of CONDITIONS) {
    if (condition in record) {
      const found = pickExport(record[condition]);
      if (found) return found;
    }
  }
  return undefined;
}

function exportFor(exports: unknown, sub: string): string | undefined {
  const wanted = sub ? `./${sub}` : ".";
  if (typeof exports === "string" || Array.isArray(exports)) {
    return wanted === "." ? pickExport(exports) : undefined;
  }
  if (typeof exports !== "object" || exports === null) return undefined;
  const record = exports as Record<string, unknown>;
  const keyed = Object.keys(record).some((key) => key.startsWith("."));
  if (!keyed) return wanted === "." ? pickExport(record) : undefined;
  if (wanted in record) return pickExport(record[wanted]);
  // Подпуть со звёздочкой: `"./*": "./dist/*.js"`.
  for (const [pattern, target] of Object.entries(record)) {
    const star = pattern.indexOf("*");
    if (star === -1) continue;
    const head = pattern.slice(0, star);
    const tail = pattern.slice(star + 1);
    if (wanted.startsWith(head) && wanted.endsWith(tail)) {
      const middle = wanted.slice(head.length, wanted.length - tail.length);
      return pickExport(target)?.replaceAll("*", middle);
    }
  }
  return undefined;
}

export type BuildInput = {
  /** Абсолютный путь к `.tsx`: его привязало к слою чтение карты. */
  entry: string;
  /** Корень проекта: запасной путь к `node_modules`, когда поиск вверх ничего не дал. */
  basePath: string;
};

export type BuildOutput = {
  build: Omit<DisplayBuild, "builtAt">;
  /** Всё прочитанное вне `node_modules`: правка любого из них пересобирает дисплей. */
  watched: string[];
};

async function bundle(
  files: FileReader,
  bundler: BundlerPort,
  input: BuildInput,
): Promise<BuildOutput> {
  const contents = new Map<string, string | undefined>();
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
      const exported = pkg.exports === undefined ? undefined : exportFor(pkg.exports, sub);
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

  const styles: string[] = [];

  const plugin: Esbuild.Plugin = {
    name: "mapward-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (PROVIDED.has(args.path)) return { path: args.path, external: true };
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
                  : `не найден пакет ${spec}: искали node_modules от ${from} вверх и в ${input.basePath}`,
              },
            ],
          };
        }
        return { path: found, namespace: "mapward" };
      });

      build.onLoad({ filter: /.*/, namespace: "mapward" }, async (args) => {
        const text = (await read(args.path)) ?? "";
        const ext = extension(args.path);
        // Css компонента едет вместе с css tailwind, а не отдельным файлом: писать его некуда.
        if (ext === ".css") {
          styles.push(text);
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
    return {
      build: { errors: [`esbuild не поднялся: ${message(error)}`] },
      watched: [input.entry],
    };
  }

  let code: string;
  try {
    const result = await api.build({
      entryPoints: [input.entry],
      bundle: true,
      write: false,
      format: "cjs",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      // Строки карты русские: без этого они уезжают `з…`, и код в ячейке не прочитать.
      charset: "utf8",
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [plugin],
    });
    code = result.outputFiles[0]?.text ?? "";
  } catch (error) {
    return { build: { errors: buildErrors(error) }, watched: watchedOf(contents, input.entry) };
  }

  const watched = watchedOf(contents, input.entry);
  const own = watched
    .filter((path) => LOADERS[extension(path)] !== undefined && extension(path) !== ".json")
    .flatMap((path) => candidates(contents.get(path) ?? ""));

  let css: string;
  try {
    css = [await tailwind([...new Set(own)]), ...styles].join("\n");
  } catch (error) {
    return { build: { code, errors: [`tailwind: ${message(error)}`] }, watched };
  }

  return { build: { code, css }, watched };
}

/**
 * Без сброса стилей (preflight) и в тех же слоях, что у карты: компонент не перекрашивает карту,
 * а одинаковые классы совпадают с уже написанными (решение 0037).
 */
async function tailwind(classes: string[]): Promise<string> {
  const sheets: Record<string, string> = {
    "tailwindcss/theme.css": themeCss,
    "tailwindcss/utilities.css": utilitiesCss,
  };
  const compiler = await compile(
    [
      "@layer theme, base, components, utilities;",
      '@import "tailwindcss/theme.css" layer(theme);',
      '@import "tailwindcss/utilities.css" layer(utilities);',
    ].join("\n"),
    {
      loadStylesheet: async (id, base) => {
        const content = sheets[id];
        if (content === undefined) throw new Error(`нет стилей ${id}`);
        return { path: id, base, content };
      },
    },
  );
  return compiler.build(classes);
}

/** Следят за своим, а не за пакетами: `node_modules` меняется установкой, а не правкой. */
const watchedOf = (contents: Map<string, string | undefined>, entry: string): string[] => {
  const read = [...contents.entries()]
    .filter(([path, text]) => text !== undefined && !path.includes("/node_modules/"))
    .map(([path]) => path);
  return read.includes(entry) ? read : [entry, ...read];
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

/**
 * Собрать компонент метрики — решение 0037. Хост без сборщика отвечает ошибкой сборки, а не
 * падением: компонент тогда не показывается, а говорит, что собрать нечем.
 */
export class BuildDisplay {
  constructor(
    private readonly files: FileReader,
    private readonly clock: ClockPort,
    private readonly bundler: BundlerPort | undefined,
  ) {}

  async run(input: BuildInput): Promise<{ build: DisplayBuild; watched: string[] }> {
    if (!this.bundler) {
      return {
        build: { errors: ["этот хост не умеет собирать компоненты"], builtAt: this.clock.now() },
        watched: [],
      };
    }
    try {
      const output = await bundle(this.files, this.bundler, input);
      return { build: { ...output.build, builtAt: this.clock.now() }, watched: output.watched };
    } catch (error) {
      return { build: { errors: [message(error)], builtAt: this.clock.now() }, watched: [] };
    }
  }
}
