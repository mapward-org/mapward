import { childAddress, MAP_ROOT, type MapEditOp } from "@mapward/core";
import type { FileReader, FileWriter, MarketPort } from "../../../ports/index.ts";
import type { MapRef } from "../../../kernel/map-ref.ts";
import { message } from "../../../lib/bundle.ts";
import { join, normalize, slash } from "../../../lib/path.ts";
import {
  copied,
  diffThree,
  MANIFEST_FILE,
  ORIGIN_FILE,
  pieceFiles,
  pieceManifest,
  pieceTops,
  pluginFiles,
  type DiffEntry,
  type Origin,
} from "../domain/package.ts";
import {
  archiveUrl,
  INDEX_FILE,
  KINDS,
  parseIndex,
  searchEntries,
  type MarketEntry,
  type MarketKind,
} from "../domain/registry.ts";
import type { Archive } from "../domain/tar.ts";
import type { MarketInstaller, MarketMapEdits, MarketPlace } from "../ports.ts";

export type MarketSearch = { registry: string; entries: MarketEntry[]; errors?: string[] };

export type MarketRead =
  | (MarketEntry & { commit?: string; files: string[]; skipped?: string[]; readme?: string })
  | (MarketEntry & { commit?: string; path: string; text: string });

export type MarketAdd =
  | {
      ok: true;
      kind: MarketKind;
      name: string;
      commit: string;
      /** Плагин — его папка; кусок карты — новые адреса. */
      plugin?: string;
      created?: string[];
      /** Номер пачки правки карты — по нему кусок отменяют `undo_edit`. */
      id?: string;
      /** Плагины, поставленные ради куска, и уже стоявшие. */
      plugins?: { name: string; plugin?: string; already?: boolean }[];
      dependencies?: string[];
      trusted: boolean;
      skipped?: string[];
    }
  | { ok: false; error: string };

export type MarketDiff = {
  kind: MarketKind;
  name: string;
  repo: string;
  branch: string;
  /** Записанный при установке коммит. */
  commit: string;
  /** Коммит ветки автора сейчас; тот же — автор ничего не менял. */
  latest: string;
  files: DiffEntry[];
};

const isRemote = (location: string) => /^https?:\/\//.test(location);
const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);

/** Ветка живёт: её архив помним минуту — столько длится чтение плагина агентом. Коммит не меняется. */
const BRANCH_TTL_MS = 60_000;

/**
 * Маркетплейс: найти в реестре, прочитать исходники до установки, поставить копией, сравнить
 * копию с веткой автора. Своего сервера нет — реестр и репозитории авторов публичны на GitHub,
 * сервер читает их через порт хоста. Поставленное — код проекта, как встроенный плагин; запись
 * «откуда» рядом с ним — для сравнения.
 */
export class Market {
  private readonly archives = new Map<string, { at: number; archive: Promise<Archive> }>();

  constructor(
    private readonly files: FileReader & FileWriter,
    private readonly port: MarketPort | undefined,
    private readonly installer: MarketInstaller,
    private readonly edit: MarketMapEdits,
    private readonly place: MarketPlace,
    /** Где реестр сейчас: адрес по http или папка на диске — её подставляет проверка реестра. */
    private readonly registry: () => string,
  ) {}

  async search(params: { query?: string; kind?: MarketKind }): Promise<MarketSearch> {
    const { entries, errors } = await this.index(params.kind);
    return {
      registry: this.registry(),
      entries: searchEntries(entries, params.query ?? ""),
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  async read(params: {
    name: string;
    kind?: MarketKind;
    path?: string;
    commit?: string;
  }): Promise<MarketRead> {
    const entry = await this.entry(params.name, params.kind);
    const archive = await this.archive(entry, params.commit);
    const commit = archive.commit;
    const head = { ...entry, ...(commit ? { commit } : {}) };
    if (params.path) {
      const path = slash(params.path).replace(/^\/+/, "");
      const text = archive.files[path];
      if (text === undefined) {
        throw new Error(
          archive.skipped.includes(path)
            ? `${path} в ${entry.repo} — не текст, его не читают и не копируют`
            : `${path} в ${entry.repo} нет; файлы — read без path`,
        );
      }
      return { ...head, path, text };
    }
    const readme = Object.keys(archive.files).find((path) => /^readme(\.md)?$/i.test(path));
    return {
      ...head,
      files: Object.keys(archive.files).filter(copied).toSorted(),
      ...(archive.skipped.length > 0 ? { skipped: archive.skipped } : {}),
      ...(readme ? { readme: archive.files[readme] } : {}),
    };
  }

  async add(
    ref: MapRef,
    params: {
      name: string;
      kind?: MarketKind;
      /** Плагину — папка от корня карты; без неё `_plugins/<имя>`. */
      path?: string;
      /** Куску карты — адрес родителя; без него корень. */
      parent?: string;
      /** Доверить сразу. Только по слову человека: агент в MCP этого не может. */
      trusted?: boolean;
    },
  ): Promise<MarketAdd> {
    try {
      const entry = await this.entry(params.name, params.kind);
      return entry.kind === "plugin"
        ? await this.addPlugin(ref, entry, params.path, params.trusted ?? false)
        : await this.addPiece(ref, entry, parentOf(params.parent), params.trusted ?? false);
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  }

  async diff(ref: MapRef, params: { path: string }): Promise<MarketDiff> {
    const folder = this.resolve(ref, params.path);
    const text = await this.files.read(join(folder, ORIGIN_FILE));
    if (text === undefined) {
      throw new Error(`в ${folder} нет ${ORIGIN_FILE} — это не установленное из маркетплейса`);
    }
    const origin = JSON.parse(text) as Origin;
    const entry: MarketEntry = {
      kind: origin.kind,
      name: origin.name,
      description: "",
      repo: origin.repo,
      branch: origin.branch,
    };
    const [base, latest] = await Promise.all([
      this.archive(entry, origin.commit),
      this.archive(entry),
    ]);
    const local = await this.tree(folder);
    const shape = (archive: Archive) => {
      if (origin.kind === "plugin") {
        const plugin = pluginFiles(archive.files);
        return "files" in plugin ? plugin.files : {};
      }
      const tops = pieceTops(archive.files);
      return pieceFiles(archive.files, origin.top ?? "", tops, origin.parent ?? MAP_ROOT);
    };
    return {
      kind: origin.kind,
      name: origin.name,
      repo: origin.repo,
      branch: origin.branch,
      commit: origin.commit,
      latest: latest.commit ?? "",
      files: diffThree(shape(base), shape(latest), local),
    };
  }

  private async addPlugin(
    ref: MapRef,
    entry: MarketEntry,
    path: string | undefined,
    trusted: boolean,
  ): Promise<MarketAdd> {
    const archive = await this.archive(entry);
    const plugin = pluginFiles(archive.files);
    if ("error" in plugin) return { ok: false, error: `${entry.repo}: ${plugin.error}` };
    const commit = archive.commit ?? "";
    const origin = this.origin(entry, commit);
    const result = await this.installer.copy(ref, {
      name: entry.name,
      sources: { ...plugin.files, [ORIGIN_FILE]: json(origin) },
      ...(path ? { folder: path } : {}),
      trusted,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      kind: "plugin",
      name: entry.name,
      commit,
      plugin: result.plugin,
      ...(result.dependencies ? { dependencies: result.dependencies } : {}),
      trusted,
      ...(archive.skipped.length > 0 ? { skipped: archive.skipped } : {}),
    };
  }

  private async addPiece(
    ref: MapRef,
    entry: MarketEntry,
    parent: string,
    trusted: boolean,
  ): Promise<MarketAdd> {
    const archive = await this.archive(entry);
    const tops = pieceTops(archive.files);
    if (tops.length === 0) {
      return {
        ok: false,
        error: `${entry.repo}: в корне нет папок объектов с _index.json — это не кусок карты`,
      };
    }
    const manifest = pieceManifest(archive.files);
    if ("error" in manifest) return { ok: false, error: `${entry.repo}: ${manifest.error}` };

    const target = await this.place(ref, parent);
    if (!target) return { ok: false, error: `нет объекта ${parent}, куда ставить кусок карты` };
    const taken = tops.filter((top) => target.children.includes(top));
    if (taken.length > 0) {
      return {
        ok: false,
        error: `у ${parent} уже есть ${taken.join(", ")}: занятое место mapward не перезаписывает — выберите другого родителя`,
      };
    }

    // Плагины — до пачки: метрики куска ссылаются на них. Упадёт пачка — плагины остаются, как
    // остаётся копия плагина, у которого не поставились зависимости.
    const plugins: { name: string; plugin?: string; already?: boolean }[] = [];
    for (const name of manifest.plugins) {
      // oxlint-disable-next-line no-await-in-loop
      plugins.push(await this.dependency(ref, name, trusted));
    }

    const commit = archive.commit ?? "";
    const ops: MapEditOp[] = [];
    for (const top of tops) {
      const folder = join(target.path, top);
      const files = pieceFiles(archive.files, top, tops, parent);
      for (const [relative, text] of Object.entries(files)) {
        ops.push({ op: "writeFile", path: join(folder, relative), text });
      }
      const origin: Origin = { ...this.origin(entry, commit), top, parent };
      ops.push({ op: "writeFile", path: join(folder, ORIGIN_FILE), text: json(origin) });
    }
    const result = await this.edit(ref, ops);
    if (!result.ok) {
      return { ok: false, error: `кусок карты не записан: ${result.error}` };
    }
    return {
      ok: true,
      kind: "map",
      name: entry.name,
      commit,
      id: result.id,
      created: tops.map((top) => childAddress(parent, top)),
      ...(plugins.length > 0 ? { plugins } : {}),
      trusted,
      ...(archive.skipped.length > 0 ? { skipped: archive.skipped } : {}),
    };
  }

  /** Плагин, нужный куску: стоит — не трогаем; есть в реестре — оттуда; встроенный — встроенный. */
  private async dependency(
    ref: MapRef,
    name: string,
    trusted: boolean,
  ): Promise<{ name: string; plugin?: string; already?: boolean }> {
    const folder = join(slash(ref.mapPath), "_plugins", name);
    if (
      (await this.files.list(join(slash(ref.mapPath), "_plugins"))).some((e) => e.name === name)
    ) {
      return { name, plugin: folder, already: true };
    }
    const { entries } = await this.index("plugin");
    const entry = entries.find((one) => one.name === name);
    if (entry) {
      const added = await this.addPlugin(ref, entry, undefined, trusted);
      if (!added.ok) throw new Error(`плагин ${name} для куска карты не поставлен: ${added.error}`);
      return { name, ...(added.plugin ? { plugin: added.plugin } : {}) };
    }
    if (this.installer.names().includes(name)) {
      const added = await this.installer.run(ref, name);
      if (!added.ok) throw new Error(`встроенный плагин ${name} не поставлен: ${added.error}`);
      return { name, plugin: added.plugin };
    }
    throw new Error(
      `плагина ${name}, который просит ${MANIFEST_FILE} куска, нет ни в реестре, ни среди встроенных`,
    );
  }

  private origin(entry: MarketEntry, commit: string): Origin {
    return {
      kind: entry.kind,
      name: entry.name,
      registry: this.registry(),
      repo: entry.repo,
      branch: entry.branch,
      commit,
    };
  }

  private async entry(name: string, kind?: MarketKind): Promise<MarketEntry> {
    const { entries } = await this.index(kind);
    const found = entries.filter((entry) => entry.name === name);
    if (found.length === 0) {
      throw new Error(`в реестре ${this.registry()} нет ${name}; найти — market_search`);
    }
    if (found.length > 1) {
      throw new Error(`${name} есть и среди плагинов, и среди кусков карты — назовите kind`);
    }
    return found[0] as MarketEntry;
  }

  private async index(kind?: MarketKind): Promise<{ entries: MarketEntry[]; errors: string[] }> {
    const kinds = kind ? [kind] : KINDS;
    const parts = await Promise.all(
      kinds.map(async (one) => {
        const text = await this.indexText(one);
        return text === undefined ? { entries: [], errors: [] } : parseIndex(text, one);
      }),
    );
    return {
      entries: parts.flatMap((part) => part.entries),
      errors: parts.flatMap((part) => part.errors),
    };
  }

  private async indexText(kind: MarketKind): Promise<string | undefined> {
    const location = this.registry();
    if (isRemote(location)) {
      return this.network().text(`${location.replace(/\/+$/, "")}/${INDEX_FILE[kind]}`);
    }
    return this.files.read(join(slash(location), INDEX_FILE[kind]));
  }

  private archive(entry: MarketEntry, commit?: string): Promise<Archive> {
    const url = archiveUrl(entry.repo, commit ? { commit } : { branch: entry.branch });
    const cached = this.archives.get(url);
    if (cached && (commit || Date.now() - cached.at < BRANCH_TTL_MS)) return cached.archive;
    const archive = this.network()
      .archive(url)
      .then((found) => {
        if (!found) {
          throw new Error(
            `${entry.repo}${commit ? ` на коммите ${commit}` : ` на ветке ${entry.branch}`} не найден: репозиторий публичный?`,
          );
        }
        return found;
      });
    // Неудачу не помним: следующий вызов спросит заново.
    archive.catch(() => this.archives.delete(url));
    this.archives.set(url, { at: Date.now(), archive });
    return archive;
  }

  private network(): MarketPort {
    if (!this.port) throw new Error("у этого хоста нет сети для маркетплейса");
    return this.port;
  }

  private resolve(ref: MapRef, path: string): string {
    const mapPath = slash(ref.mapPath);
    const given = slash(path.trim());
    const target = isAbsolute(given) ? normalize(given) : join(mapPath, given);
    if (!target.startsWith(`${mapPath}/`)) throw new Error(`${path} не внутри карты ${mapPath}`);
    return target;
  }

  /** Файлы установленной копии — путь от её папки; зависимости и запись «откуда» не в счёт. */
  private async tree(folder: string, prefix = ""): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await this.files.list(join(folder, prefix))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!copied(relative)) continue;
      if (entry.isDirectory) {
        // oxlint-disable-next-line no-await-in-loop
        Object.assign(result, await this.tree(folder, relative));
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop
      const text = await this.files.read(join(folder, relative));
      if (text !== undefined) result[relative] = text;
    }
    return result;
  }
}

/** Адрес родителя куска: без него корень, хвостовой слэш не в счёт. */
const parentOf = (given: string | undefined) =>
  !given || given === MAP_ROOT ? MAP_ROOT : given.replace(/\/+$/, "");

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
