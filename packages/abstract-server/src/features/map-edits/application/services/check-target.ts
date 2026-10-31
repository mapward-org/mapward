import type {
  CheckReport,
  CheckStep,
  ComponentBuild,
  MapAction,
  MapMetric,
  MapObject,
  MetricGroup,
} from "@mapward/core";
import { findActionOwner, findMetricOwner, findObject, isAddress } from "@mapward/core";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { message } from "../../../../lib/bundle.ts";
import { schemaErrors } from "../../../../lib/schema-errors.ts";
import type { MapEditsBuilds, MapEditsPlugins } from "../../ports.ts";
import { filePath } from "../../domain/fields.ts";

/** Ответ запроса для агента — коротко: проверке важно, что он есть, а не он целиком. */
const SAMPLE = 200;

const sample = (value: unknown): string => {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > SAMPLE ? `${text.slice(0, SAMPLE)}…` : text;
};

/** Сколько ждать пробный запрос для агента, если зовущий не назвал. */
export const CHECK_TIMEOUT_MS = 30_000;

const built = (title: string, build: ComponentBuild): CheckStep =>
  build.errors && build.errors.length > 0
    ? { title, status: "fail", lines: build.errors }
    : { title, status: "ok", lines: [`собран: ${String(build.code?.length ?? 0)} байт`] };

/** Все объекты карты под `root` — по ним ищут, у кого есть метрика, названная группой. */
function* everyObject(root: MapObject): Generator<MapObject> {
  yield root;
  for (const child of root.children) yield* everyObject(child);
}

/** Та же группа — унаследованная: тот же ключ и тот же список метрик. */
const sameGroup = (a: MetricGroup, b: MetricGroup) =>
  a.key === b.key && JSON.stringify(a.metrics) === JSON.stringify(b.metrics);

/**
 * Метрики, названные группами объекта. Группа прототипа называет метрики для всех наследников,
 * и у самого прототипа какой-то может не быть — её определяют наследники. Ошибка — ключ, которого
 * нет ни у кого с этой группой: такую метрику удалили, а группа о ней помнит.
 */
function groupSteps(root: MapObject, object: MapObject): CheckStep[] {
  const steps: CheckStep[] = [];
  for (const group of object.metricGroups) {
    const have = new Set(object.metrics.map((metric) => metric.key));
    const missing = group.metrics.filter((key) => !have.has(key));
    if (missing.length === 0) {
      steps.push({
        title: `группа «${group.key}»: метрики`,
        status: "ok",
        lines: [`все ${String(group.metrics.length)} есть у объекта`],
      });
      continue;
    }
    const kin = [...everyObject(root)].filter((other) =>
      other.metricGroups.some((one) => sameGroup(one, group)),
    );
    const lines: string[] = [];
    let failed = false;
    for (const key of missing) {
      const owners = kin.filter((other) => other.metrics.some((metric) => metric.key === key));
      if (owners.length === 0) {
        failed = true;
        lines.push(`${key}: метрики нет ни у этого объекта, ни у объектов с этой группой`);
      } else {
        lines.push(`${key}: у этого объекта нет, есть у ${String(owners.length)} с этой группой`);
      }
    }
    steps.push({
      title: `группа «${group.key}»: метрики`,
      status: failed ? "fail" : "ok",
      lines,
    });
  }
  return steps;
}

/**
 * Проверка по адресу — отдельным вызовом, а не побочным эффектом записи: `set` проверяет поля, а
 * собирается ли компонент и отвечает ли запрос для агента, видно, только когда их запустить.
 * Метрика — сборка компонента (ошибки с файлом и позицией) и пробный запрос; объект — метрики,
 * названные его группами (и унаследованными тоже), раскладки групп и свои метрики; экшон — форма и метод; папка плагина — как `check_plugin`.
 */
export class CheckTarget {
  constructor(
    private readonly builds: MapEditsBuilds,
    private readonly plugins: MapEditsPlugins,
  ) {}

  async run(ref: MapRef, root: MapObject, target: string, timeout: number): Promise<CheckReport> {
    const report = (steps: CheckStep[]): CheckReport => ({
      target,
      ok: steps.every((step) => step.status !== "fail"),
      steps,
    });

    if (!isAddress(target)) {
      const path = filePath(target, ref.mapPath);
      if (typeof path !== "string")
        return report([{ title: "плагин", status: "fail", lines: [path.error] }]);
      const checked = await this.plugins.check(ref, path, timeout);
      return { ...checked, target };
    }

    const metric = findMetricOwner(root, target)?.metric;
    if (metric) return report(await this.metric(ref, metric, timeout));
    const action = findActionOwner(root, target)?.action;
    if (action) return report(await this.action(ref, action));
    const object = findObject(root, target);
    if (!object) {
      return report([
        {
          title: target,
          status: "fail",
          lines: ["по адресу нет ни объекта, ни метрики, ни экшона"],
        },
      ]);
    }
    if (object.isGroup) {
      return report([
        {
          title: target,
          status: "skip",
          lines: ["полка: проверять нечего — слой проверяется метрикой, которая его подключает"],
        },
      ]);
    }
    const steps: CheckStep[] = groupSteps(root, object);
    for (const group of object.metricGroups) {
      if (group.layout === undefined) continue;
      // oxlint-disable-next-line no-await-in-loop -- сборщик один, сборки по очереди
      steps.push(
        built(
          `раскладка группы «${group.key}»`,
          await this.builds.layout(ref, object.address, group.key),
        ),
      );
    }
    for (const own of object.metrics) {
      if (own.owner !== undefined) continue;
      // oxlint-disable-next-line no-await-in-loop
      steps.push(...(await this.metric(ref, own, timeout)));
    }
    if (steps.length === 0)
      steps.push({ title: target, status: "skip", lines: ["ни раскладок, ни своих метрик"] });
    return report(steps);
  }

  private async metric(ref: MapRef, metric: MapMetric, timeout: number): Promise<CheckStep[]> {
    const steps: CheckStep[] = [];
    const head = `метрика ${metric.address}`;
    steps.push(
      metric.config.component
        ? built(`${head}: компонент`, await this.builds.metric(ref, metric.address))
        : {
            title: `${head}: компонент`,
            status: "fail",
            lines: ["component не задан — метрике нечем рисоваться"],
          },
    );
    const agent = metric.config.agent;
    if (!agent) {
      steps.push({
        title: `${head}: запрос для агента`,
        status: "skip",
        lines: ["запроса нет — агент видит метрику только по методам плагина"],
      });
      return steps;
    }
    try {
      const value = await this.plugins.first(
        ref,
        agent.plugin,
        agent.method,
        agent.params ?? {},
        timeout,
      );
      steps.push({
        title: `${head}: запрос для агента`,
        status: "ok",
        lines: [`${agent.method} ответил: ${sample(value)}`],
      });
    } catch (error) {
      steps.push({
        title: `${head}: запрос для агента`,
        status: "fail",
        lines: [`${agent.method} упал: ${message(error)}`],
      });
    }
    return steps;
  }

  private async action(ref: MapRef, action: MapAction): Promise<CheckStep[]> {
    const head = `экшон ${action.address}`;
    const steps: CheckStep[] = [];
    if (action.config.component) {
      steps.push(built(`${head}: форма`, await this.builds.actionForm(ref, action.address)));
    }
    const { plugin, method } = action.config;
    if (!plugin || !method) {
      steps.push({
        title: `${head}: метод`,
        status: "fail",
        lines: ["plugin и method не заданы — кнопке нечего звать"],
      });
      return steps;
    }
    try {
      const described = await this.plugins.describe(ref, plugin);
      const found = described.methods[method];
      const lines: string[] = [];
      if (!found) lines.push(`у плагина нет метода ${method}`);
      else if (found.kind !== "mutation")
        lines.push(`${method} читающий, а экшон зовёт изменяющий`);
      else if (found.params !== undefined) {
        const required = schemaErrors(
          { ...(found.params as object), required: [] },
          action.config.params ?? {},
        );
        lines.push(...required);
      }
      steps.push({
        title: `${head}: метод`,
        status: lines.length > 0 ? "fail" : "ok",
        lines: lines.length > 0 ? lines : [`${method} (mutation)`],
      });
    } catch (error) {
      steps.push({
        title: `${head}: метод`,
        status: "fail",
        lines: [`плагин ${plugin} не отвечает: ${message(error)}`],
      });
    }
    return steps;
  }
}
