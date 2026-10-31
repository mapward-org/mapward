// Приложения проверяют сервер по исходникам, и объявление `?raw` доходит до них только так.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../../../../raw-modules.ts" />
import type { BundlerPort, FileReader, FileWriter } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { bundle, message } from "../../../../lib/bundle.ts";
import { join } from "../../../../lib/path.ts";
import { scriptName } from "../../domain/plugin-object.ts";
// `@mapward/plugin` едет текстом внутри сервера — собранным одним файлом со всеми зависимостями —
// и подставляется сборке плагина: у установленного расширения `node_modules` нет, а копия из
// проекта могла бы разойтись с протоколом платформы.
import pluginSource from "@mapward/plugin/dist/index.mjs?raw";

const ENTRY = "mapward:plugin-entry";
const PLUGIN = "@mapward/plugin";

/**
 * Модули, которые плагину даёт платформа, — из `platformModules` того же `@mapward/plugin`:
 * одна копия rxjs и typebox на процесс, и плагин их не ставит. Список — договор с пакетом: имя
 * без пары там сборка подставит как пустой модуль, и это поймает тест сборки.
 */
const PLATFORM_MODULES = [
  "rxjs",
  "rxjs/operators",
  "typebox",
  "typebox/compile",
  "typebox/error",
  "typebox/format",
  "typebox/guard",
  "typebox/schema",
  "typebox/system",
  "typebox/type",
  "typebox/value",
];

/**
 * Модуль-переходник: CommonJS, чтобы не перечислять имена, а `__esModule` — чтобы
 * `import Type from "typebox"` взял `default` модуля, а не весь модуль.
 */
const platformModule = (name: string) => ({
  loader: "js" as const,
  contents: `module.exports = { __esModule: true, ...require(${JSON.stringify(PLUGIN)}).platformModules[${JSON.stringify(name)}] };`,
});
const ENTRIES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"];

export type PluginBuild = { script: string } | { errors: string[] };

/**
 * Сборка плагина в один CommonJS-файл для node: TypeScript собирает платформа, поэтому в
 * проекте не нужны ни `tsx`, ни шаг сборки. Файл ложится в `.mapward/plugins/` карты — вне git.
 */
export class BuildPlugin {
  constructor(
    private readonly files: FileReader & FileWriter,
    private readonly bundler: BundlerPort | undefined,
  ) {}

  /**
   * Вход плагина — `index.ts` и родня. Нет его — нет и плагина: это не поломка кода, и хост
   * говорит об этом раньше, чем спрашивать о доверии к пустой папке.
   */
  async entry(plugin: string): Promise<string | undefined> {
    for (const name of ENTRIES) {
      // oxlint-disable-next-line no-await-in-loop
      if ((await this.files.read(join(plugin, name))) !== undefined) return join(plugin, name);
    }
    return undefined;
  }

  async run(ref: MapRef, plugin: string): Promise<PluginBuild> {
    if (!this.bundler) return { errors: ["этот хост не умеет собирать плагины"] };

    const entry = await this.entry(plugin);
    if (!entry) return { errors: [`у плагина ${plugin} нет index.ts`] };

    const output = await bundle(this.files, this.bundler, {
      entry: ENTRY,
      basePath: ref.basePath,
      platform: "node",
      provided: new Set(),
      virtual: {
        [ENTRY]: {
          loader: "ts",
          contents: [
            `import * as loaded from ${JSON.stringify(entry)};`,
            'import { startStdio } from "@mapward/plugin";',
            "startStdio((loaded as { default?: never }).default ?? (loaded as never));",
          ].join("\n"),
        },
        [PLUGIN]: { loader: "js", contents: pluginSource },
        ...Object.fromEntries(PLATFORM_MODULES.map((name) => [name, platformModule(name)])),
      },
    });
    if ("errors" in output) return { errors: output.errors };

    const script = join(ref.mapPath, ".mapward", "plugins", scriptName(ref.mapPath, plugin));
    try {
      // `.mapward` — локальное: сборки, прогоны, корзина. В git ему не место.
      await this.files.write(join(ref.mapPath, ".mapward", ".gitignore"), "*\n");
      await this.files.write(script, output.code);
    } catch (error) {
      return { errors: [`сборку плагина не записать: ${message(error)}`] };
    }
    return { script };
  }
}
