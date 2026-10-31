// Приложения проверяют сервер по исходникам, и объявление `?raw` доходит до них только так.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../../../../raw-modules.ts" />
import { compile } from "tailwindcss";
import type { ComponentBuild } from "@mapward/core";
import type { BundlerPort, ClockPort, FileReader } from "../../../../ports/index.ts";
import { bundle, isCode, message, watchedOf } from "../../../../lib/bundle.ts";
import { candidates } from "../../domain/component.ts";
import { fingerprint, inPackage, statPrint, type BuildInputs } from "../../domain/build-inputs.ts";
// Стили tailwind едут текстом внутри сервера: у установленного расширения `node_modules` нет.
import themeCss from "tailwindcss/theme.css?raw";
import utilitiesCss from "tailwindcss/utilities.css?raw";

/**
 * Сборка компонента — решение 0037: `.tsx` метрики в CommonJS-модуль и css на его
 * классы. Файлы читаются портом, а не файловой системой esbuild: так сборка одинаково работает
 * в расширении и в cli, а список прочитанного получается сам — по нему потом и следят.
 */

/**
 * Это отдаёт клиент: две копии React на странице ломают хуки. `react-dom` — для библиотек
 * компонента, которым нужны порталы (холст плагина `objects-map` на `@xyflow/react`): своя копия
 * из `node_modules` плагина была бы вторым рендерером поверх того же React. `rxjs` — тоже клиента:
 * потоки плагинов приходят его `Observable`, и компонент работает с ними, ничего не ставя.
 */
const PROVIDED = new Set([
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@mapward/component",
  "rxjs",
  "rxjs/operators",
]);

export type BuildInput = {
  /** Абсолютный путь к `.tsx`: его привязало к слою чтение карты. */
  entry: string;
  /** Корень проекта: запасной путь к `node_modules`, когда поиск вверх ничего не дал. */
  basePath: string;
};

export type BuildOutput = {
  build: Omit<ComponentBuild, "builtAt">;
  /** Всё прочитанное вне `node_modules`: правка любого из них пересобирает компонент. */
  watched: string[];
  /** Все ответы файлов сборщику — по ним сборку можно не повторять (`fresh`). */
  inputs?: BuildInputs;
};

/**
 * Версия того, чем собирают: формат сборки, что отдаёт карта, стили tailwind. Поменялась —
 * сохранённые сборки недействительны, как бы ни совпадали входы.
 */
export const BUILD_STAMP = fingerprint(
  ["component-build/1", [...PROVIDED].join(","), themeCss, utilitiesCss].join("\n"),
);

async function build(
  files: FileReader,
  bundler: BundlerPort,
  input: BuildInput,
): Promise<BuildOutput> {
  // Css компонента едет вместе с css tailwind, а не отдельным файлом: писать его некуда.
  const styles: string[] = [];
  // Настоящие пути за ссылками — тоже ответы файлов: переставленная ссылка меняет сборку.
  const reals: Record<string, string> = {};
  const realpath = files.realpath?.bind(files);
  const recording: FileReader = {
    read: (path) => files.read(path),
    list: (path) => files.list(path),
    ...(realpath
      ? {
          realpath: async (path: string) => {
            const real = await realpath(path);
            reals[path] = real ?? path;
            return real;
          },
        }
      : {}),
  };
  const output = await bundle(recording, bundler, {
    entry: input.entry,
    basePath: input.basePath,
    platform: "browser",
    provided: PROVIDED,
    onCss: (text) => styles.push(text),
  });
  const watched = watchedOf(output.contents, input.entry);
  const inputs = await inputsOf(files, output.contents, reals);
  if ("errors" in output) return { build: { errors: output.errors }, watched, inputs };

  const own = watched.filter(isCode).flatMap((path) => candidates(output.contents.get(path) ?? ""));

  let css: string;
  try {
    css = [await tailwind([...new Set(own)]), ...styles].join("\n");
  } catch (error) {
    return {
      build: { code: output.code, errors: [`tailwind: ${message(error)}`] },
      watched,
      inputs,
    };
  }

  return { build: { code: output.code, css }, watched, inputs };
}

/** Отпечаток ответа на чтение: пакет — по `stat`, если хост его умеет, остальное — по тексту. */
async function printOf(
  files: FileReader,
  path: string,
  text: string | undefined,
): Promise<string | null> {
  if (text === undefined) return null;
  if (inPackage(path) && files.stat) {
    const stat = await files.stat(path);
    if (stat) return statPrint(stat);
  }
  return fingerprint(text);
}

async function inputsOf(
  files: FileReader,
  contents: Map<string, string | undefined>,
  reals: Record<string, string>,
): Promise<BuildInputs> {
  const entries = await Promise.all(
    [...contents].map(async ([path, text]) => [path, await printOf(files, path, text)] as const),
  );
  return { reads: Object.fromEntries(entries), reals: { ...reals } };
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

/**
 * Собрать компонент метрики — решение 0037. Хост без сборщика отвечает ошибкой сборки, а не
 * падением: компонент тогда не показывается, а говорит, что собрать нечем.
 */
export class BuildComponent {
  constructor(
    private readonly files: FileReader,
    private readonly clock: ClockPort,
    private readonly bundler: BundlerPort | undefined,
  ) {}

  async run(
    input: BuildInput,
  ): Promise<{ build: ComponentBuild; watched: string[]; inputs?: BuildInputs }> {
    if (!this.bundler) {
      return {
        build: { errors: ["этот хост не умеет собирать компоненты"], builtAt: this.clock.now() },
        watched: [],
      };
    }
    try {
      const output = await build(this.files, this.bundler, input);
      return {
        build: { ...output.build, builtAt: this.clock.now() },
        watched: output.watched,
        ...(output.inputs ? { inputs: output.inputs } : {}),
      };
    } catch (error) {
      return { build: { errors: [message(error)], builtAt: this.clock.now() }, watched: [] };
    }
  }

  /**
   * Те же ли ответы дали бы файлы сейчас — а значит, та же вышла бы сборка. Спрашивается всё
   * разом: файлов у сборки с пакетами — сотни, а ждать их по одному незачем.
   */
  async fresh(inputs: BuildInputs): Promise<boolean> {
    try {
      const reads = Promise.all(
        Object.entries(inputs.reads).map(
          async ([path, print]) =>
            (await printOf(this.files, path, await this.files.read(path))) === print,
        ),
      );
      const reals = Promise.all(
        Object.entries(inputs.reals).map(async ([path, real]) => {
          const now = this.files.realpath ? await this.files.realpath(path) : path;
          return (now ?? path) === real;
        }),
      );
      const [readsSame, realsSame] = await Promise.all([reads, reals]);
      return readsSame.every(Boolean) && realsSame.every(Boolean);
    } catch {
      return false;
    }
  }
}
