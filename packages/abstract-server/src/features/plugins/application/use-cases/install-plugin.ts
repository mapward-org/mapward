import { builtinPlugins, type PluginSources } from "@mapward/plugins";
import type { FileReader, FileWriter, PackagesPort, TrustPort } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { message } from "../../../../lib/bundle.ts";
import { basename, dirname, join, normalize, slash } from "../../../../lib/path.ts";

export type InstallResult =
  | {
      ok: true;
      plugin: string;
      files: string[];
      /** Поставленные зависимости из `package.json` плагина; нет их — поля нет. */
      dependencies?: string[];
    }
  | { ok: false; error: string };

/**
 * Чем ставятся зависимости плагина — npm, всегда, а не менеджер проекта. Папка плагина — не член
 * рабочего пространства проекта: pnpm внутри pnpm-проекта ставил бы всё пространство, а npm
 * кладёт плоский `node_modules` в саму папку, где сборщик компонента его и находит. Без dev- и
 * peer-зависимостей: React и `@mapward/component` отдаёт карта, своя копия была бы второй.
 * Без lock-файла: в папке плагина — только его код и `node_modules` под `.gitignore`.
 */
export const PLUGIN_INSTALL = {
  command: "npm",
  args: ["install", "--omit=dev", "--omit=peer", "--no-package-lock", "--no-audit", "--no-fund"],
} as const;

/** Так npm говорит, что до реестра не достучаться. */
const OFFLINE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|network/i;

/** Куда встроенный плагин ложится по умолчанию — и где хост ищет его, чтобы доставить сам. */
const PLUGINS_DIR = "_plugins";

const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);

/**
 * Установка встроенного плагина в карту — по модели shadcn: исходники копируются один раз, и
 * дальше это код проекта. Существующую папку не трогаем никогда: там может быть правка
 * человека или агента, и «обновить» значило бы её стереть.
 *
 * Скопированное самим mapward — доверено: код пришёл с инструментом, спрашивать о нём нечего.
 */
export class InstallPlugin {
  constructor(
    private readonly files: FileReader & FileWriter,
    private readonly trust: TrustPort | undefined,
    private readonly sources: Readonly<Record<string, PluginSources>> = builtinPlugins,
    private readonly packages?: PackagesPort,
  ) {}

  /** Имена встроенных — их перечисляют тому, кто ищет плагин, которого нет. */
  names(): string[] {
    return Object.keys(this.sources);
  }

  /** `folder` — от корня карты или абсолютный внутри неё; без него — `_plugins/<имя>`. */
  async run(ref: MapRef, name: string, folder?: string): Promise<InstallResult> {
    const sources = this.sources[name];
    if (!sources) {
      return {
        ok: false,
        error: `встроенного плагина ${name} нет; есть: ${this.names().join(", ")}`,
      };
    }
    // Встроенный пришёл с инструментом — ему доверяют сразу.
    return this.copy(ref, { name, sources, ...(folder ? { folder } : {}), trusted: true });
  }

  /**
   * Копия исходников, пришедших не с инструментом, — из маркетплейса. Правила те же, что у
   * встроенного: занятую папку не трогаем, `index.*` — последним, зависимости — npm. Доверие —
   * по слову зовущего: чужой код доверенным сам не становится, его подтверждает человек.
   */
  async copy(
    ref: MapRef,
    params: { name: string; sources: PluginSources; folder?: string; trusted: boolean },
  ): Promise<InstallResult> {
    const { name, sources, folder, trusted } = params;
    const mapPath = slash(ref.mapPath);
    const given = folder ? slash(folder.trim()) : `${PLUGINS_DIR}/${name}`;
    const target = isAbsolute(given) ? normalize(given) : join(mapPath, given);
    // Плагин — часть карты: путь мимо неё (`..`, чужая папка) значил бы писать куда попало.
    if (!target.startsWith(`${mapPath}/`)) {
      return { ok: false, error: `папка ${given} не внутри карты ${mapPath}` };
    }
    if (await this.exists(target)) {
      return {
        ok: false,
        error: `${target} уже есть: существующую копию mapward не перезаписывает — правьте её или выберите другую папку`,
      };
    }

    const written: string[] = [];
    try {
      // `index.ts` — последним: оборванное копирование не должно выглядеть рабочим плагином.
      const order = Object.keys(sources).toSorted(
        (a, b) => Number(a.startsWith("index.")) - Number(b.startsWith("index.")),
      );
      for (const relative of order) {
        const path = join(target, relative);
        // oxlint-disable-next-line no-await-in-loop
        await this.files.write(path, sources[relative] ?? "");
        written.push(path);
      }
      if (trusted) await this.trust?.grant({ mapPath, plugin: target });
    } catch (error) {
      return { ok: false, error: `плагин ${name} не скопирован в ${target}: ${message(error)}` };
    }

    const installed = await this.dependencies(target, sources, true, trusted);
    if ("error" in installed) return { ok: false, error: installed.error };
    return {
      ok: true,
      plugin: target,
      files: written,
      ...(installed.names.length > 0 ? { dependencies: installed.names } : {}),
    };
  }

  /**
   * Зависимости из `package.json` плагина — после копирования, в его папке. Копия при отказе
   * остаётся: она уже код проекта, а поставить зависимости человек может и сам — команду ему
   * называем.
   */
  private async dependencies(
    target: string,
    sources: PluginSources,
    copied = true,
    trusted = true,
  ): Promise<{ names: string[] } | { error: string }> {
    const manifest = sources["package.json"];
    if (manifest === undefined) return { names: [] };
    let names: string[];
    try {
      const parsed = JSON.parse(manifest) as { dependencies?: Record<string, string> };
      names = Object.keys(parsed.dependencies ?? {});
    } catch (error) {
      return { error: `package.json плагина в ${target} не разобрать: ${message(error)}` };
    }
    if (names.length === 0) return { names };

    const by = `cd "${target}" && ${PLUGIN_INSTALL.command} ${PLUGIN_INSTALL.args.join(" ")}`;
    const head = copied
      ? `плагин скопирован в ${target}${trusted ? " и доверен" : ""}, но его зависимости (${names.join(", ")}) не поставлены`
      : `зависимости плагина ${target} (${names.join(", ")}) не поставлены`;
    if (!this.packages) {
      return { error: `${head}: этот хост пакеты не ставит. Поставьте сами: ${by}` };
    }
    try {
      await this.packages.install(target);
    } catch (error) {
      const text = message(error);
      const why = OFFLINE.test(text) ? "нет сети — npm не достучался до реестра пакетов" : text;
      return { error: `${head}: ${why}. Поставьте сами, когда будет можно: ${by}` };
    }
    return { names };
  }

  /**
   * Зависимости своего плагина — то же, что при установке встроенного: `dependencies` из его
   * `package.json`, npm в его папке. Папка — от корня карты или абсолютная внутри неё.
   */
  async installDeps(
    ref: MapRef,
    folder: string,
  ): Promise<{ dependencies: string[] } | { error: string }> {
    const mapPath = slash(ref.mapPath);
    const given = slash(folder.trim());
    const target = isAbsolute(given) ? normalize(given) : join(mapPath, given);
    if (!target.startsWith(`${mapPath}/`)) {
      return { error: `папка ${given} не внутри карты ${mapPath}` };
    }
    const manifest = await this.files.read(join(target, "package.json"));
    if (manifest === undefined) return { error: `в ${target} нет package.json — ставить нечего` };
    const installed = await this.dependencies(target, { "package.json": manifest }, false);
    return "error" in installed ? installed : { dependencies: installed.names };
  }

  /**
   * Плагин по пути `<карта>/_plugins/<имя>` встроенного, а папки нет — значит, его ещё не
   * копировали: хост доставляет его сам, прежде чем поднимать. Отвечает, скопировал ли.
   */
  async restore(ref: MapRef, plugin: string): Promise<boolean> {
    const path = slash(plugin);
    const name = basename(path);
    if (!this.sources[name] || path !== join(ref.mapPath, PLUGINS_DIR, name)) return false;
    if (await this.exists(path)) return false;
    const result = await this.run(ref, name);
    if (!result.ok) throw new Error(result.error);
    return true;
  }

  /** Папку видно по родителю: пустая и отсутствующая папки `list` отвечают одинаково. */
  private async exists(path: string): Promise<boolean> {
    const name = basename(path);
    return (await this.files.list(dirname(path))).some((entry) => entry.name === name);
  }
}
