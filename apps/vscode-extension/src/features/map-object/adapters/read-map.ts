import * as vscode from "vscode";
import { Check } from "typebox/value";
import {
  childAddress,
  MAP_ROOT,
  mapAddress,
  parseAddress,
  readField,
} from "../pure-model/address.ts";
import { mergeIndex, mergeMetric } from "../pure-model/merge.ts";
import type { MapFile, MapMetric, MapObject } from "../pure-model/model.ts";
import { findObject } from "../pure-model/model.ts";
import { MetricConfig, ObjectIndex } from "../pure-model/schema.ts";
import { substituteDeep } from "../pure-model/substitution.ts";

const INDEX = "_index.json";
const METRICS = "_metrics";
const DIRECTIVES = "_directives";
const ACTIONS = "_actions";
const SERVICE = new Set([METRICS, DIRECTIVES, ACTIONS, "_directives.state"]);

async function readJson(uri: vscode.Uri): Promise<unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
  } catch {
    return undefined;
  }
}

async function entries(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return [];
  }
}

async function readFiles(uri: vscode.Uri): Promise<MapFile[]> {
  return (await entries(uri))
    .filter(([, type]) => type === vscode.FileType.File)
    .map(([name]) => ({ name, path: vscode.Uri.joinPath(uri, name).fsPath }));
}

async function readMetrics(objectUri: vscode.Uri, address: string): Promise<MapMetric[]> {
  const dir = vscode.Uri.joinPath(objectUri, METRICS);
  const metrics: MapMetric[] = [];

  for (const [key, type] of await entries(dir)) {
    if (type !== vscode.FileType.Directory) continue;
    const configUri = vscode.Uri.joinPath(dir, key, "config.json");
    // oxlint-disable-next-line no-await-in-loop
    const raw = await readJson(configUri);
    if (raw === undefined) continue;
    metrics.push({
      key,
      address: `${childAddress(address, METRICS)}/${key}`,
      configPath: configUri.fsPath,
      config: Check(MetricConfig, raw) ? raw : {},
    });
  }

  return metrics;
}

/** Reads the tree as written on disk. Inheritance and substitution come after — they need
 * the whole map to look things up in. */
async function readTree(uri: vscode.Uri, address: string, name: string): Promise<MapObject> {
  const index = await readJson(vscode.Uri.joinPath(uri, INDEX));
  const own: ObjectIndex = Check(ObjectIndex, index) ? index : {};

  const children: MapObject[] = [];
  for (const [child, type] of await entries(uri)) {
    if (type !== vscode.FileType.Directory || SERVICE.has(child)) continue;
    // Depth first: children are read in the order they will be listed.
    // oxlint-disable-next-line no-await-in-loop
    const node = await readTree(
      vscode.Uri.joinPath(uri, child),
      childAddress(address, child),
      child,
    );
    children.push(node);
  }

  return {
    address,
    path: uri.fsPath,
    name: own.name ?? name,
    isGroup: index === undefined,
    props: own.props ?? {},
    previewSize: own["preview-size"],
    previewLayout: own["preview-metrics-layout"],
    detailsLayout: own["details-metrics-layout"],
    metrics: await readMetrics(uri, address),
    directives: await readFiles(vscode.Uri.joinPath(uri, DIRECTIVES)),
    actions: await readFiles(vscode.Uri.joinPath(uri, ACTIONS)),
    children,
    rawExtends: own.extends,
  } as MapObject & { rawExtends?: string };
}

type Raw = MapObject & { rawExtends?: string };

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
      return mine ? { ...mine, config: mergeMetric(metric.config, mine.config) } : metric;
    }),
    ...object.metrics.filter((metric) => !prototype.metrics.some((p) => p.key === metric.key)),
  ];
  object.directives = [...prototype.directives, ...object.directives];
  object.actions = [...prototype.actions, ...object.actions];
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
export async function readMap(mapPath: string, basePath: string, name: string): Promise<MapObject> {
  const root = (await readTree(vscode.Uri.file(mapPath), MAP_ROOT, name)) as Raw;
  inherit(root, root);
  apply(root, root, basePath);
  return root;
}
