import { Check } from "typebox/value";
import {
  adoptMetric,
  childAddress,
  findObject,
  MAP_ROOT,
  mapAddress,
  MetricConfig,
  ObjectIndex,
  parseAddress,
  readField,
} from "@mapward/core";
import type { MapFile, MapMetric, MapObject } from "@mapward/core";
import type { FilesPort } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";
import { mergeIndex, mergeMetric } from "../../domain/merge.ts";
import { substituteDeep } from "../../domain/substitution.ts";

const INDEX = "_index.json";
const METRICS = "_metrics";
const DIRECTIVES = "_directives";
const ACTIONS = "_actions";
const STATE = "_directives.state";
const SERVICE = new Set([METRICS, DIRECTIVES, ACTIONS, STATE]);

async function readJson(files: FilesPort, path: string): Promise<unknown> {
  const text = await files.read(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readFiles(files: FilesPort, dir: string): Promise<MapFile[]> {
  return (await files.list(dir))
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({ name: entry.name, path: join(dir, entry.name) }));
}

/** Git may store either ending; a directive that only changed line endings has not changed. */
const norm = (value: string | undefined) => value?.replaceAll("\r\n", "\n");

/**
 * A directive knows three states, and all three come from comparing its text with the copy
 * the run left behind: no copy means new, a different copy means changed — decision 0002.
 */
async function readDirectives(files: FilesPort, objectPath: string): Promise<MapFile[]> {
  const list = await readFiles(files, join(objectPath, DIRECTIVES));

  return Promise.all(
    list.map(async (file) => {
      const base = file.name.replace(/.md$/, "");
      const state = await files.read(join(objectPath, STATE, `${base}.state.json`));
      if (!state) return { ...file, status: "new" as const };

      const text = await files.read(file.path);
      try {
        const copy = (JSON.parse(state) as { directive?: string }).directive;
        const same = norm(copy) === norm(text);
        return { ...file, status: same ? ("done" as const) : ("changed" as const) };
      } catch {
        return { ...file, status: "new" as const };
      }
    }),
  );
}

async function readMetrics(
  files: FilesPort,
  objectPath: string,
  address: string,
): Promise<MapMetric[]> {
  const dir = join(objectPath, METRICS);
  const metrics: MapMetric[] = [];

  for (const entry of await files.list(dir)) {
    if (!entry.isDirectory) continue;
    const configPath = join(dir, entry.name, "config.json");
    // oxlint-disable-next-line no-await-in-loop
    const raw = await readJson(files, configPath);
    if (raw === undefined) continue;
    metrics.push({
      key: entry.name,
      address: `${childAddress(address, METRICS)}/${entry.name}`,
      configPath,
      cachePath: join(dir, entry.name),
      config: Check(MetricConfig, raw) ? raw : {},
    });
  }

  return metrics;
}

type Raw = MapObject & { rawExtends?: string };

/**
 * Reads the tree as written on disk. Inheritance and substitution come after — they need the
 * whole map to look things up in.
 */
async function readTree(
  files: FilesPort,
  path: string,
  address: string,
  name: string,
): Promise<MapObject> {
  const index = await readJson(files, join(path, INDEX));
  const own: ObjectIndex = Check(ObjectIndex, index) ? index : {};

  const children: MapObject[] = [];
  for (const entry of await files.list(path)) {
    if (!entry.isDirectory || SERVICE.has(entry.name)) continue;
    // Depth first: children are read in the order they will be listed.
    // oxlint-disable-next-line no-await-in-loop
    const node = await readTree(
      files,
      join(path, entry.name),
      childAddress(address, entry.name),
      entry.name,
    );
    children.push(node);
  }

  return {
    address,
    path,
    name: own.name ?? name,
    isGroup: index === undefined,
    props: own.props ?? {},
    previewSize: own["preview-size"],
    previewLayout: own["preview-metrics-layout"],
    detailsLayout: own["details-metrics-layout"],
    metrics: await readMetrics(files, path, address),
    directives: await readDirectives(files, path),
    actions: await readFiles(files, join(path, ACTIONS)),
    children,
    rawExtends: own.extends,
  } as Raw;
}

/**
 * A metric may extend another metric — decision 0004. Its address points at a folder with a
 * `config.json`, which need not live under `_metrics`: that is how one shared metric serves
 * many objects.
 *
 * Metric inheritance runs before object inheritance, so an object inherits metrics that are
 * already whole.
 */
async function inheritMetrics(
  files: FilesPort,
  object: Raw,
  mapPath: string,
  seen = new Set<string>(),
): Promise<void> {
  for (const child of object.children as Raw[]) await inheritMetrics(files, child, mapPath, seen);

  for (const metric of object.metrics) {
    const address = metric.config.extends;
    if (!address || seen.has(metric.address)) continue;
    seen.add(metric.address);

    const parsed = parseAddress(address);
    if (!parsed || parsed.scope !== "map") continue;

    const configPath = join(mapPath, ...parsed.path, "config.json");
    // oxlint-disable-next-line no-await-in-loop
    const raw = await readJson(files, configPath);
    if (!Check(MetricConfig, raw)) continue;

    const parent: MapMetric = {
      key: metric.key,
      address,
      configPath,
      // Only the config is taken from the parent; the cache stays where the metric itself lives.
      cachePath: metric.cachePath,
      config: raw,
    };
    // The parent may extend something in turn.
    // oxlint-disable-next-line no-await-in-loop
    await inheritMetrics(
      files,
      { ...object, metrics: [parent], children: [] } as Raw,
      mapPath,
      seen,
    );
    metric.config = mergeMetric(parent.config, metric.config);
  }
}

/**
 * Унаследованный файл помечается владельцем: лежит он у прототипа, и править его надо там.
 * Свой файл поля не получает — ставить его на себя значило бы шуметь в каждом ответе.
 * Владелец сохраняется из цепочки: прототип мог сам получить файл выше.
 */
const byName = (inherited: MapFile[], own: MapFile[], from: string): MapFile[] => {
  const mine = new Set(own.map((file) => file.name));
  return [
    ...inherited
      .filter((file) => !mine.has(file.name))
      .map((file) => (file.owner ? file : { ...file, owner: from })),
    ...own,
  ];
};

/** `extends` resolves recursively; a cycle is an error, not a hang. */
function inherit(root: Raw, object: Raw, seen: Set<string> = new Set()): void {
  for (const child of object.children as Raw[]) inherit(root, child, new Set());

  const address = object.rawExtends;
  if (!address || seen.has(object.address)) return;
  seen.add(object.address);

  const prototype = findObject(root, address) as Raw | undefined;
  if (!prototype) return;
  inherit(root, prototype, seen);

  const merged = mergeIndex(
    {
      name: prototype.name,
      props: prototype.props,
      "preview-size": prototype.previewSize,
      "preview-metrics-layout": prototype.previewLayout,
      "details-metrics-layout": prototype.detailsLayout,
    },
    {
      name: object.name,
      props: object.props,
      "preview-size": object.previewSize,
      "preview-metrics-layout": object.previewLayout,
      "details-metrics-layout": object.detailsLayout,
    },
  );

  object.prototypeName = prototype.name;
  object.props = merged.props ?? {};
  object.previewSize = merged["preview-size"];
  object.previewLayout = merged["preview-metrics-layout"];
  object.detailsLayout = merged["details-metrics-layout"];

  // Metrics of the prototype come along; a metric of the same key overrides its parent.
  const own = new Map(object.metrics.map((metric) => [metric.key, metric]));
  object.metrics = [
    ...prototype.metrics.map((metric) => {
      const mine = own.get(metric.key);
      // Свой `config.json` есть — метрика заведена здесь, даже если часть полей от прототипа.
      // Нет — метрика чужая, и это видно по владельцу, как у директив с экшонами.
      return mine
        ? { ...mine, config: mergeMetric(metric.config, mine.config) }
        : { ...adoptMetric(object, metric), owner: metric.owner ?? prototype.address };
    }),
    ...object.metrics.filter((metric) => !prototype.metrics.some((p) => p.key === metric.key)),
  ];
  // По имени, и своё выигрывает: прототип достаётся нескольким наследникам, и без дедупа
  // один и тот же экшон приезжает столько раз, сколько их в цепочке.
  object.directives = byName(prototype.directives, object.directives, prototype.address);
  object.actions = byName(prototype.actions, object.actions, prototype.address);
}

/**
 * Substitution runs after inheritance, so `~` means the concrete object rather than the
 * prototype it borrowed the expression from — decision 0006.
 */
function resolver(root: MapObject, self: MapObject, basePath: string, depth = 0) {
  return (raw: string): string | undefined => {
    const address = parseAddress(raw);
    if (!address || depth > 10) return undefined;

    if (address.scope === "base") return [basePath, ...address.path].join("/");

    const target =
      address.scope === "self"
        ? address.path.length === 0
          ? self
          : findObject(root, address.path.reduce(childAddress, self.address))
        : findObject(root, mapAddress(address.path));

    if (!target) return undefined;
    // Without a hash an address gives an absolute file path — decision 0005.
    if (!address.field) return target.path;

    const value = readField({ name: target.name, props: target.props }, address.field);
    if (value === undefined) return undefined;
    // A prop may itself be an expression: resolve it before handing it on.
    return typeof value === "string"
      ? substituteDeep(value, resolver(root, target, basePath, depth + 1))
      : String(value);
  };
}

function apply(root: MapObject, object: MapObject, basePath: string): void {
  const resolve = resolver(root, object, basePath);
  object.props = substituteDeep(object.props, resolve);
  object.metrics = object.metrics.map((metric) => ({
    ...metric,
    config: substituteDeep(metric.config, resolve),
  }));
  for (const child of object.children) apply(root, child, basePath);
}

/** Reads a map into the shape the sidebar draws: tree, inheritance, substitution. */
export async function readMap(
  files: FilesPort,
  mapPath: string,
  basePath: string,
  name: string,
): Promise<MapObject> {
  const root = (await readTree(files, mapPath, MAP_ROOT, name)) as Raw;
  await inheritMetrics(files, root, mapPath);
  inherit(root, root);
  apply(root, root, basePath);
  return root;
}
