import type { MapMetric, MapObject } from "@mapward/core";
import { schemaErrors } from "../../../../lib/schema-errors.ts";
import type { PluginDescription } from "@mapward/plugin";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { message } from "../../../../lib/bundle.ts";
import { slash } from "../../../../lib/path.ts";
import type { PluginBuild } from "./build-plugin.ts";

/** Шаг проверки: прошёл, упал или пропущен (проверять нечего); строки — что именно. */
export type CheckStep = { title: string; status: "ok" | "fail" | "skip"; lines: string[] };

export type PluginCheck = { plugin: string; ok: boolean; steps: CheckStep[] };

/** Что проверке нужно от платформы: сборка, процесс плагина, карта и сборка компонента. */
export type CheckPluginPorts = {
  build(ref: MapRef, plugin: string): Promise<PluginBuild>;
  /** Поднять процесс и дождаться рукопожатия: ответ — самоописание. */
  describe(ref: MapRef, plugin: string): Promise<PluginDescription>;
  /** Первое значение метода или отказ по сроку. */
  first(
    ref: MapRef,
    plugin: string,
    method: string,
    args: unknown,
    timeout: number,
  ): Promise<unknown>;
  map(ref: MapRef): Promise<MapObject>;
  /** Сборка компонента метрики — та же, что на карте. */
  buildComponent(ref: MapRef, metric: string): Promise<{ errors?: string[]; code?: string }>;
};

/** Ответ запроса для агента — коротко: проверке важно, что он есть, а не он целиком. */
const SAMPLE = 200;

const sample = (value: unknown): string => {
  const json = JSON.stringify(value) ?? "undefined";
  return json.length > SAMPLE ? `${json.slice(0, SAMPLE)}…` : json;
};

/** Схема, которую валидатор не читает, — ошибка автора; данные здесь ни при чём. */
const unreadable = (schema: unknown): string[] =>
  schemaErrors(schema, {}).filter((line) => line.startsWith("схема не читается"));

function metricsOf(object: MapObject): MapMetric[] {
  return [...object.metrics, ...object.children.flatMap(metricsOf)];
}

/**
 * Работает ли плагин — одной командой: сборка, процесс и
 * рукопожатие, самоописание и его схемы, а потом метрики карты, которые на плагин ссылаются, —
 * их компонент собирается, а запрос для агента зовётся пробно. Ошибки — строками с файлом и
 * позицией, как их даёт сборщик: агенту хватает их, чтобы чинить.
 *
 * Метрика ссылается на плагин, если её запрос для агента зовёт его (`agent.plugin`) или её
 * компонент лежит в его папке. Кого компонент зовёт хуками, статически не узнать — это видно
 * только на экране.
 */
export class CheckPlugin {
  constructor(private readonly ports: CheckPluginPorts) {}

  async run(ref: MapRef, given: string, timeout: number): Promise<PluginCheck> {
    const plugin = slash(given);
    const steps: CheckStep[] = [];
    const done = (): PluginCheck => ({
      plugin,
      ok: steps.every((step) => step.status !== "fail"),
      steps,
    });

    const build = await this.ports.build(ref, plugin);
    if ("errors" in build) {
      steps.push({ title: "сборка", status: "fail", lines: build.errors });
      return done();
    }
    steps.push({ title: "сборка", status: "ok", lines: [build.script] });

    let description: PluginDescription;
    try {
      description = await this.ports.describe(ref, plugin);
    } catch (error) {
      steps.push({
        title: "процесс и рукопожатие",
        status: "fail",
        lines: message(error).split(/\r?\n/),
      });
      return done();
    }
    steps.push({ title: "процесс и рукопожатие", status: "ok", lines: [] });
    steps.push(this.describeStep(description));

    for (const metric of metricsOf(await this.ports.map(ref))) {
      const component = metric.config.component ? slash(metric.config.component) : undefined;
      const agent = metric.config.agent;
      const asks = agent !== undefined && slash(agent.plugin) === plugin;
      const owns = component?.startsWith(`${plugin}/`) === true;
      if (!asks && !owns) continue;
      // oxlint-disable-next-line no-await-in-loop -- метрики по одной: процесс плагина один
      steps.push(await this.metricStep(ref, metric, description, asks, timeout));
    }
    return done();
  }

  private describeStep(description: PluginDescription): CheckStep {
    const lines: string[] = [];
    let failed = false;
    for (const [name, method] of Object.entries(description.methods)) {
      lines.push(`${name} (${method.kind})${method.description ? `: ${method.description}` : ""}`);
      for (const [part, schema] of [
        ["params", method.params],
        ["result", method.result],
      ] as const) {
        if (schema === undefined) continue;
        for (const line of unreadable(schema)) {
          failed = true;
          lines.push(`  ${name}.${part}: ${line}`);
        }
      }
    }
    // Шаблоны метрик — тоже то, что плагин даёт карте: у `views` методов нет вовсе.
    for (const [name, template] of Object.entries(description.templates ?? {})) {
      lines.push(`шаблон ${name}: ${template.component}`);
      for (const line of template.params === undefined ? [] : unreadable(template.params)) {
        failed = true;
        lines.push(`  шаблон ${name}.params: ${line}`);
      }
    }
    if (lines.length === 0) {
      return {
        title: "самоописание",
        status: "fail",
        lines: ["у плагина нет ни одного метода и ни одного шаблона"],
      };
    }
    return { title: "самоописание", status: failed ? "fail" : "ok", lines };
  }

  private async metricStep(
    ref: MapRef,
    metric: MapMetric,
    description: PluginDescription,
    asks: boolean,
    timeout: number,
  ): Promise<CheckStep> {
    const lines: string[] = [];
    let failed = false;
    let skipped = false;
    const fail = (line: string) => {
      failed = true;
      lines.push(line);
    };

    if (metric.config.component) {
      const built = await this.ports.buildComponent(ref, metric.address);
      if (built.errors && built.errors.length > 0) {
        fail("компонент не собрался:");
        for (const line of built.errors) lines.push(`  ${line}`);
      } else {
        lines.push(`компонент собран: ${String(built.code?.length ?? 0)} байт`);
      }
    }

    const agent = metric.config.agent;
    if (!agent) {
      lines.push("запроса для агента нет — агент видит метрику только по методам плагина");
    } else if (asks) {
      const method = description.methods[agent.method];
      const args = agent.params ?? {};
      if (!method) {
        fail(`запрос для агента зовёт ${agent.method}, а такого метода у плагина нет`);
      } else {
        const wrong = method.params === undefined ? [] : schemaErrors(method.params, args);
        const unresolved = unresolvedIn(args);
        if (wrong.length > 0) {
          fail(`параметры запроса для агента не прошли схему ${agent.method}:`);
          for (const line of wrong) lines.push(`  ${line}`);
        } else if (unresolved.length > 0) {
          // У прототипа подстановка ждёт наследника: пробный вызов ушёл бы в несуществующий путь
          // и покраснел бы ложно. Сам запрос проверится на объекте, где всё разрешилось.
          skipped = true;
          lines.push(
            `запрос для агента не зовём — подстановки не разрешились: ${unresolved.join(", ")}`,
          );
        } else {
          try {
            const value = await this.ports.first(ref, agent.plugin, agent.method, args, timeout);
            lines.push(`запрос для агента ${agent.method} ответил: ${sample(value)}`);
          } catch (error) {
            fail(`запрос для агента ${agent.method} упал: ${message(error)}`);
          }
        }
      }
    }

    const status = failed ? "fail" : skipped ? "skip" : "ok";
    return { title: `метрика ${metric.address}`, status, lines };
  }
}

/** Выражения, которые подстановка не разрешила, — по метке, которую она оставляет в строке. */
function unresolvedIn(value: unknown): string[] {
  if (typeof value === "string") {
    return [...value.matchAll(/«не разрешилось: ([^»]*)»/g)].map((match) => match[1] ?? "");
  }
  if (Array.isArray(value)) return [...new Set(value.flatMap(unresolvedIn))];
  if (typeof value === "object" && value !== null) {
    return [...new Set(Object.values(value).flatMap(unresolvedIn))];
  }
  return [];
}
