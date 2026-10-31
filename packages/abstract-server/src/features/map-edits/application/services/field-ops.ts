import type { MapEditOp, MapObject } from "@mapward/core";
import { contentVersion, isAddress } from "@mapward/core";
import type { MetricTemplate, PluginDescription } from "@mapward/plugin";
import type { FileReader } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { message } from "../../../../lib/bundle.ts";
import { basename, dirname, join, slash } from "../../../../lib/path.ts";
import { schemaErrors } from "../../../../lib/schema-errors.ts";
import type { MapEditsPlugins, MapSchemas } from "../../ports.ts";
import {
  configPath,
  fieldErrors,
  filePath,
  isRecord,
  partial,
  readStage,
  resolvePath,
  StageSchema,
  writeStage,
  type StageContent,
} from "../../domain/fields.ts";
import { indexed, json, planEdit, referencesTo, type FileChange } from "../../domain/plan.ts";
import { locate, type Target } from "../../domain/targets.ts";

export type FieldOp = Extract<
  MapEditOp,
  { op: "get" | "set" | "delete" | "readFile" | "writeFile" | "removeFile" }
>;

/** Посчитанная операция: правки файлов и ответ — или отказ с подробностями. */
export type FieldPlan =
  | { changes: FileChange[]; result: unknown }
  | { error: string; errors?: string[]; current?: unknown };

/** Снимок для операции: модель карты и тексты её файлов (`mapFiles`). */
export type FieldContext = { root: MapObject; files: ReadonlyMap<string, string> };

const fail = (error: string, errors?: string[]): FieldPlan => ({
  error,
  ...(errors && errors.length > 0 ? { errors } : {}),
});

/** Конфиг со ссылкой на папку плагина: путь абсолютный, а самоописание — по запросу. */
type Described = { dir: string; description: PluginDescription } | { error: string };

/**
 * Свои поля по адресу и сырые файлы карты: `get`/`set`/`delete` объекта, метрики, экшона, слоя и
 * этапа, `readFile`/`writeFile`/`removeFile`. Считает правки файлов и ответ, а пишет `EditMap` —
 * той же пачкой с отменой, что и структуру.
 *
 * `set` — полная замена с проверкой: схемой платформы, существованием того, на что конфиг
 * ссылается (прототип, файл компонента, плагин, метод), и схемой параметров из самоописания
 * плагина. Ошибки — строкой на поле, путём от корня файла: по ним агент чинит запись.
 */
export class FieldOps {
  constructor(
    private readonly reader: FileReader,
    private readonly schemas: MapSchemas,
    private readonly plugins: MapEditsPlugins,
  ) {}

  async plan(ref: MapRef, context: FieldContext, op: FieldOp): Promise<FieldPlan> {
    switch (op.op) {
      case "readFile": {
        const path = filePath(op.path, ref.mapPath);
        if (typeof path !== "string") return fail(path.error);
        const text = await this.reader.read(path);
        return {
          changes: [],
          result: {
            path,
            text: text ?? null,
            version: text === undefined ? null : contentVersion(text),
          },
        };
      }
      case "writeFile": {
        const path = filePath(op.path, ref.mapPath);
        if (typeof path !== "string") return fail(path.error);
        const before = await this.reader.read(path);
        const stale = this.stale(before, op.version, () => ({
          path,
          text: before ?? null,
          version: before === undefined ? null : contentVersion(before),
        }));
        if (stale) return stale;
        return {
          changes: [{ kind: "write", path, text: op.text }],
          result: { path, version: contentVersion(op.text) },
        };
      }
      case "removeFile": {
        const path = filePath(op.path, ref.mapPath);
        if (typeof path !== "string") return fail(path.error);
        if ((await this.reader.read(path)) === undefined) return fail(`Нет файла ${path}`);
        return { changes: [{ kind: "remove", path }], result: { path } };
      }
      case "get":
        return this.get(context, op.address);
      case "set":
        return this.set(ref, context, op);
      case "delete":
        return this.remove(context, op);
    }
  }

  private async target(
    context: FieldContext,
    address: string,
    layer = false,
  ): Promise<Target | { error: string }> {
    // Слой — папка без индекса, но с `config.json`: смотрится по диску, модели слои неизвестны.
    const configs = new Set<string>();
    const found = locate(context.root, address, {
      layer,
      layerExists: (file) => configs.has(file),
    });
    if ("error" in found || found.kind !== "directory") return found;
    const config = join(found.object.path, "config.json");
    if ((await this.reader.read(config)) === undefined) return found;
    configs.add(config);
    return locate(context.root, address, { layer, layerExists: (file) => configs.has(file) });
  }

  /** Отказ «файл изменился», если `version` передана и не та. */
  private stale(
    text: string | undefined,
    version: string | undefined,
    current: () => unknown,
  ): FieldPlan | undefined {
    if (version === undefined) return undefined;
    if (text !== undefined && contentVersion(text) === version) return undefined;
    return {
      error:
        "Файл изменился с переданной version — перечитай: свежее содержимое и version в current",
      current: current(),
    };
  }

  /** Как цель выглядит для `get`: `content` разобранным, `version` — отпечаток текста. */
  private shape(target: Target, text: string): unknown {
    const version = contentVersion(text);
    if (target.kind === "stage") {
      return { content: readStage(basename(target.file).replace(/\.md$/, ""), text), version };
    }
    try {
      return { content: JSON.parse(text) as unknown, version };
    } catch (error) {
      return { content: null, text, version, error: `не JSON: ${message(error)}` };
    }
  }

  private async get(context: FieldContext, address: string): Promise<FieldPlan> {
    const target = await this.target(context, address);
    if ("error" in target) return fail(target.error);
    if (target.kind === "directory") {
      return fail(`${address} — полка: своих полей нет; set индекса сделает её объектом`);
    }
    const text = await this.reader.read(target.file);
    if (text === undefined) {
      const inherited =
        target.kind === "stage"
          ? target.owner.workflow.find((stage) => stage.path.endsWith(`/${basename(target.file)}`))
              ?.owner
          : undefined;
      return fail(
        inherited
          ? `Этап ${address} приехал от ${inherited}: свои поля — там`
          : `Нет файла ${target.file}`,
      );
    }
    return {
      changes: [],
      result: { address, path: target.file, ...(this.shape(target, text) as object) },
    };
  }

  private async set(
    ref: MapRef,
    context: FieldContext,
    op: Extract<MapEditOp, { op: "set" }>,
  ): Promise<FieldPlan> {
    const target = await this.target(context, op.address, op.kind === "layer");
    if ("error" in target) return fail(target.error);
    const before = await this.reader.read(target.file);
    const stale = this.stale(before, op.version, () =>
      before === undefined
        ? null
        : { address: op.address, path: target.file, ...(this.shape(target, before) as object) },
    );
    if (stale) return stale;

    const written = await this.content(ref, context, target, op.content);
    if ("error" in written) return written;
    return {
      changes: [{ kind: "write", path: target.file, text: written.text }],
      result: {
        address: op.address,
        path: target.file,
        version: contentVersion(written.text),
        created: before === undefined,
        // Короткая форма метрики развёрнута: агент видит, что легло в файл.
        ...(written.expanded ? { content: written.expanded } : {}),
      },
    };
  }

  /** Текст файла цели по `content` — после всех проверок. */
  private async content(
    ref: MapRef,
    context: FieldContext,
    target: Target,
    content: unknown,
  ): Promise<{ text: string; expanded?: unknown } | { error: string; errors?: string[] }> {
    const refused = (errors: string[]) =>
      fail(`${target.address}: не записано — поля не прошли проверку`, errors) as {
        error: string;
        errors?: string[];
      };

    if (target.kind === "stage") {
      const errors = schemaErrors(StageSchema, content);
      if (errors.length > 0) return refused(errors);
      const stage = content as StageContent;
      return { text: writeStage({ ...stage, marksDone: stage.marksDone === true }) };
    }
    if (!isRecord(content)) return refused(["/: ожидался объект JSON"]);

    if (target.kind === "object" || target.kind === "directory") {
      const errors = schemaErrors(this.schemas.object, content);
      const extended = content.extends;
      if (typeof extended === "string" && !indexed(context.root, extended)) {
        errors.push(`/extends: нет объекта ${extended}`);
      }
      if (typeof extended === "string" && extended === target.address) {
        errors.push("/extends: объект не бывает своим прототипом");
      }
      return errors.length > 0 ? refused(errors) : { text: json(content) };
    }

    const dir = dirname(target.file);
    const isAction =
      target.kind === "action" ||
      (target.kind === "layer" &&
        ("method" in content || ("plugin" in content && !("template" in content))));
    if (isAction) {
      const errors = await this.checkAction(ref, dir, content);
      return errors.length > 0 ? refused(errors) : { text: json(content) };
    }

    let config = content;
    let expanded: unknown;
    if ("template" in content) {
      const result = await this.expand(ref, target.address, content);
      if ("errors" in result) return refused(result.errors);
      config = result.config;
      expanded = config;
    }
    const errors = await this.checkMetric(ref, dir, config);
    if (errors.length > 0) return refused(errors);
    return { text: json(config), ...(expanded === undefined ? {} : { expanded }) };
  }

  private async describe(ref: MapRef, raw: string, dir: string): Promise<Described> {
    const path = resolvePath(raw, dir, ref);
    if (path === undefined) return { error: `путь ${raw} с подстановкой — не проверить` };
    if ((await this.reader.read(join(path, "index.ts"))) === undefined) {
      return { error: `плагина нет: в ${path} нет index.ts` };
    }
    try {
      return { dir: path, description: await this.plugins.describe(ref, path) };
    } catch (error) {
      return { error: `плагин ${path} не отвечает: ${message(error)}` };
    }
  }

  /**
   * Короткая форма метрики по шаблону плагина: `{ label?, plugin, template, params }` →
   * `{ label, component, params, agent }`. Пути пишутся от корня карты подстановкой.
   */
  private async expand(
    ref: MapRef,
    address: string,
    short: Record<string, unknown>,
  ): Promise<{ config: Record<string, unknown> } | { errors: string[] }> {
    const { label, plugin, template, params, ...rest } = short;
    const errors = Object.keys(rest).map(
      (key) => `/${key}: в короткой форме только label, plugin, template, params`,
    );
    if (typeof plugin !== "string") errors.push("/plugin: нужна папка плагина строкой");
    if (typeof template !== "string") errors.push("/template: нужно имя шаблона строкой");
    if (label !== undefined && typeof label !== "string") errors.push("/label: ожидалась строка");
    if (params !== undefined && !isRecord(params)) errors.push("/params: ожидался объект");
    if (errors.length > 0 || typeof plugin !== "string" || typeof template !== "string") {
      return { errors };
    }
    // Плагин короткой формы — от корня карты, как его пишет агент в `describe_plugin`.
    const described = await this.describe(ref, plugin, ref.mapPath);
    if ("error" in described) return { errors: [`/plugin: ${described.error}`] };
    const templates = described.description.templates ?? {};
    const chosen = templates[template];
    if (!chosen) {
      const known = Object.keys(templates);
      return {
        errors: [
          `/template: у плагина нет шаблона ${template}; есть: ${known.join(", ") || "ни одного"}`,
        ],
      };
    }
    const given = (params ?? {}) as Record<string, unknown>;
    const wrong = chosen.params === undefined ? [] : fieldErrors(chosen.params, given, "/params");
    if (wrong.length > 0) return { errors: wrong };

    const agent = this.agentOf(chosen, described.dir, address, given, ref);
    return {
      config: {
        ...(label === undefined ? {} : { label }),
        component: configPath(join(described.dir, chosen.component), ref),
        params: given,
        ...(agent === undefined ? {} : { agent }),
      },
    };
  }

  private agentOf(
    template: MetricTemplate,
    pluginDir: string,
    address: string,
    params: Record<string, unknown>,
    ref: MapRef,
  ): unknown {
    const agent = template.agent;
    if (!agent) return undefined;
    if ("param" in agent) {
      const request = params[agent.param];
      return isRecord(request) &&
        typeof request.plugin === "string" &&
        typeof request.method === "string"
        ? {
            plugin: request.plugin,
            method: request.method,
            ...(request.params === undefined ? {} : { params: request.params }),
          }
        : undefined;
    }
    const args = {
      ...agent.params,
      ...(agent.metric === undefined ? {} : { [agent.metric]: address }),
    };
    return {
      plugin: configPath(pluginDir, ref),
      method: agent.method,
      ...(Object.keys(args).length > 0 ? { params: args } : {}),
    };
  }

  /** Конфиг метрики: поля платформы, прототип, компонент, параметры шаблона, запрос для агента. */
  private async checkMetric(
    ref: MapRef,
    dir: string,
    config: Record<string, unknown>,
  ): Promise<string[]> {
    const errors = schemaErrors(this.schemas.metric, config);
    if (errors.length > 0) return errors;
    errors.push(...(await this.checkExtends(ref, config.extends, "metric")));

    if (typeof config.component === "string") {
      const component = resolvePath(config.component, dir, ref);
      if (component !== undefined && (await this.reader.read(component)) === undefined) {
        errors.push(`/component: файла нет: ${component}`);
      } else if (component !== undefined) {
        errors.push(...(await this.templateParams(ref, component, config.params)));
      }
    }

    const agent = config.agent as { plugin: string; method: string; params?: unknown } | undefined;
    if (agent) {
      const described = await this.describe(ref, agent.plugin, dir);
      if ("error" in described) {
        if (!described.error.includes("подстановкой"))
          errors.push(`/agent/plugin: ${described.error}`);
      } else {
        const method = described.description.methods[agent.method];
        if (!method) {
          const known = Object.keys(described.description.methods).join(", ");
          errors.push(
            `/agent/method: у плагина нет метода ${agent.method}; есть: ${known || "ни одного"}`,
          );
        } else if (method.params !== undefined) {
          errors.push(...fieldErrors(method.params, agent.params ?? {}, "/agent/params"));
        }
      }
    }
    return errors;
  }

  /**
   * Параметры метрики по схеме шаблона: компонент лежит в папке плагина, и у плагина есть шаблон
   * с этим компонентом. Плагин не отвечает или шаблона нет — проверять нечем, и это не ошибка.
   */
  private async templateParams(ref: MapRef, component: string, params: unknown): Promise<string[]> {
    const pluginDir = dirname(component);
    if ((await this.reader.read(join(pluginDir, "index.ts"))) === undefined) return [];
    let description: PluginDescription;
    try {
      description = await this.plugins.describe(ref, pluginDir);
    } catch {
      return [];
    }
    const template = Object.values(description.templates ?? {}).find(
      (one) => join(pluginDir, one.component) === slash(component),
    );
    if (!template?.params) return [];
    return fieldErrors(template.params, params ?? {}, "/params");
  }

  private async checkExtends(
    ref: MapRef,
    extended: unknown,
    kind: "metric" | "action",
  ): Promise<string[]> {
    if (typeof extended !== "string") return [];
    if (!isAddress(extended))
      return [
        `/extends: нужен адрес mapward://… слоя или ${kind === "metric" ? "метрики" : "экшона"}`,
      ];
    const folder = resolvePath(extended, ref.mapPath, ref);
    if (folder === undefined) return [];
    return (await this.reader.read(join(folder, "config.json"))) === undefined
      ? [`/extends: по адресу ${extended} нет config.json`]
      : [];
  }

  /** Конфиг экшона: поля платформы, прототип, плагин, изменяющий метод, параметры, форма. */
  private async checkAction(
    ref: MapRef,
    dir: string,
    config: Record<string, unknown>,
  ): Promise<string[]> {
    const errors = schemaErrors(this.schemas.action, config);
    if (errors.length > 0) return errors;
    errors.push(...(await this.checkExtends(ref, config.extends, "action")));
    if (typeof config.component === "string") {
      const form = resolvePath(config.component, dir, ref);
      if (form !== undefined && (await this.reader.read(form)) === undefined) {
        errors.push(`/component: файла нет: ${form}`);
      }
    }
    if (typeof config.plugin !== "string") {
      if (config.method !== undefined && config.extends === undefined) {
        errors.push("/plugin: метод назван, а плагин нет");
      }
      return errors;
    }
    if (typeof config.method !== "string") {
      return [...errors, "/method: нужен изменяющий метод плагина"];
    }
    const described = await this.describe(ref, config.plugin, dir);
    if ("error" in described) {
      if (!described.error.includes("подстановкой")) errors.push(`/plugin: ${described.error}`);
      return errors;
    }
    const method = described.description.methods[config.method];
    if (!method) {
      const known = Object.entries(described.description.methods)
        .filter(([, one]) => one.kind === "mutation")
        .map(([name]) => name);
      errors.push(
        `/method: у плагина нет метода ${config.method}; изменяющие: ${known.join(", ") || "ни одного"}`,
      );
    } else if (method.kind !== "mutation") {
      errors.push(`/method: ${config.method} читающий, а экшон зовёт изменяющий`);
    } else if (method.params !== undefined) {
      errors.push(...fieldErrors(partial(method.params), config.params ?? {}, "/params"));
    }
    return errors;
  }

  private async remove(
    context: FieldContext,
    op: Extract<MapEditOp, { op: "delete" }>,
  ): Promise<FieldPlan> {
    const target = await this.target(context, op.address);
    if ("error" in target) return fail(target.error);
    switch (target.kind) {
      case "object": {
        if (op.keepChildren !== true) {
          const plan = planEdit(context, { op: "delete", address: op.address });
          return "error" in plan
            ? fail(plan.error)
            : { changes: plan.changes, result: { address: op.address } };
        }
        return this.unindex(context, target.object);
      }
      case "directory": {
        const plan = planEdit(context, {
          op: "delete",
          address: op.address,
          ...(op.recursive === undefined ? {} : { recursive: op.recursive }),
        });
        return "error" in plan
          ? fail(plan.error)
          : { changes: plan.changes, result: { address: op.address } };
      }
      case "metric":
      case "action":
      case "layer":
        if ((await this.reader.read(target.file)) === undefined)
          return fail(`Нет файла ${target.file}`);
        return {
          changes: [{ kind: "remove", path: target.folder }],
          result: { address: op.address },
        };
      case "stage":
        if ((await this.reader.read(target.file)) === undefined)
          return fail(`Нет файла ${target.file}`);
        return {
          changes: [{ kind: "remove", path: target.file }],
          result: { address: op.address },
        };
    }
  }

  /**
   * Объект → полка: уходят `_index.json` и служебное объекта — `_metrics`, `_actions`,
   * `_directives*`: полка без индекса их не показывает, а оставленные лежали бы мёртвым грузом.
   * Всё — в корзину пачки, отмена вернёт. Дети остаются. На объект ссылаются — отказ: ссылка
   * повисла бы.
   */
  private async unindex(context: FieldContext, object: MapObject): Promise<FieldPlan> {
    if (object.path === context.root.path) {
      return fail("Корень карты полкой не становится");
    }
    const own = (path: string) => path.startsWith(`${object.path}/_`);
    const referrers = referencesTo(context.files, object.address, own);
    if (referrers.length > 0) {
      return fail(
        `На ${object.address} ссылаются: ${referrers.join(", ")} — полкой его не сделать`,
      );
    }
    const entries = await this.reader.list(object.path);
    const changes: FileChange[] = entries
      .filter((entry) => entry.name.startsWith("_"))
      .map((entry) => ({ kind: "remove", path: join(object.path, entry.name) }));
    return { changes, result: { address: object.address } };
  }
}
