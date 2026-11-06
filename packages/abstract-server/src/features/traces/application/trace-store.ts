import { Observable, map as mapStream } from "rxjs";
import {
  actionArgs,
  actionForm,
  checkInputs,
  findActionOwner,
  memberOwner,
  PLATFORM_LOG,
} from "@mapward/core";
import type {
  LogLine,
  MapAction,
  Run,
  RunSource,
  RunStarted,
  RunStatus,
  TraceRef,
} from "@mapward/core";
import type { ClockPort } from "../../../ports/index.ts";
import type { MapRef } from "../../../kernel/map-ref.ts";
import { runsOf } from "../domain/runs.ts";
import type { TracesActivity, TracesLogs, TracesMapSource, TracesPlugins } from "../ports.ts";

/** Сколько строк объекта перебирать ради его прогонов. */
const RUN_LINES = 5_000;

/** Предел итога в строке лога: огромный итог остаётся строкой о себе. */
const RESULT_LIMIT = 200_000;

function cappedValue(value: unknown): unknown {
  const text = JSON.stringify(value) ?? "";
  return text.length <= RESULT_LIMIT ? value : `итог в ${text.length} знаков не сохранён`;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Что заводит трейс: экшон и метрика дают прогон, остальное — только строки лога. */
export type TraceStart = {
  traceKind: "action" | "metric" | "mcp" | "call";
  source: RunSource;
  object?: string;
  target?: string;
  label?: string;
  inputs?: Record<string, unknown>;
  config?: unknown;
  /** Трейс, внутри которого этот заведён: отмена того снимает и этот. */
  parent?: string;
};

/** Идущий трейс: на каком объекте, чей он, как его снять и чего ждать. */
type Live = { object?: string; parent?: string; cancel: () => void; done: Promise<void> };

/**
 * Трейсы — запуски. Любой вход в платформу заводит трейс: кнопка экшона, строка списка, MCP,
 * терминал, сбор метрики. Здесь — память об идущих: кто их отменит и чего ждать. Сохраняется
 * трейс строками своего начала и конца в `mapward.log`, а прогон экшона или метрики собирается
 * из строк лога — своего хранилища у прогонов нет.
 */
export class TraceStore {
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly logs: TracesLogs,
    private readonly map: TracesMapSource,
    private readonly plugins: TracesPlugins,
    private readonly clock: ClockPort,
    /** Лента в кружке: идущие и упавшие экшоны видно по всей карте, откуда бы их ни запустили. */
    private readonly activity?: TracesActivity,
  ) {}

  private platform(mapPath: string, line: Omit<LogLine, "at" | "file">): void {
    this.logs.write(mapPath, { at: this.clock.now(), file: PLATFORM_LOG, ...line });
  }

  /** Завести трейс: номер и строка начала. */
  begin(mapPath: string, start: TraceStart): TraceRef {
    const trace = this.plugins.nextId("t");
    const { parent, ...rest } = start;
    this.platform(mapPath, {
      kind: "trace-start",
      trace,
      ...rest,
      ...(parent === undefined ? {} : { parent }),
    });
    return { trace, ...(start.object === undefined ? {} : { object: start.object }) };
  }

  /**
   * Трейс по номеру, пришедшему снаружи — заголовком MCP от агента экшона: идущий отдаётся со своим
   * объектом, и строки агента ложатся на экран прогонов того же объекта.
   */
  refOf(trace: string): TraceRef {
    const object = this.live.get(trace)?.object;
    return { trace, ...(object === undefined ? {} : { object }) };
  }

  /** Строка конца трейса. */
  end(
    mapPath: string,
    trace: TraceRef,
    status: RunStatus,
    extra: { result?: unknown; error?: string; ms?: number } = {},
  ): void {
    this.platform(mapPath, {
      kind: "trace-end",
      trace: trace.trace,
      ...(trace.object === undefined ? {} : { object: trace.object }),
      status,
      ...(extra.result === undefined ? {} : { result: cappedValue(extra.result) }),
      ...(extra.error === undefined ? {} : { error: extra.error }),
      ...(extra.ms === undefined ? {} : { ms: extra.ms }),
    });
  }

  /** Вход MCP: строка в `mapward.log` — инструмент, трейс, сколько шёл, ошибка. */
  mcp(
    mapPath: string,
    entry: { tool: string; trace: string; ms: number; error?: string; object?: string },
  ): void {
    this.platform(mapPath, {
      kind: "mcp",
      trace: entry.trace,
      method: entry.tool,
      ms: entry.ms,
      status: entry.error === undefined ? "success" : "failure",
      ...(entry.error === undefined ? {} : { error: entry.error }),
      ...(entry.object === undefined ? {} : { object: entry.object }),
    });
  }

  /** Номер трейса для входа, который прогона не даёт: вызов из интерфейса, MCP. */
  newTrace(object?: string): TraceRef {
    return { trace: this.plugins.nextId("t"), ...(object === undefined ? {} : { object }) };
  }

  /**
   * Вызов метода плагина от метрики: трейс метрики кончается её первым значением — дальше поток
   * живёт подпиской, и его строки идут в лог тем же трейсом. Отписка до первого значения —
   * остановлен, ошибка — упал.
   */
  metricCall(
    ref: MapRef,
    plugin: string,
    method: string,
    args: unknown,
    metric: { object: string; metric?: string; source?: RunSource },
  ): Observable<unknown> {
    return new Observable<unknown>((sink) => {
      const startedAt = Date.parse(this.clock.now());
      const trace = this.begin(ref.mapPath, {
        traceKind: "metric",
        source: metric.source ?? "refresh",
        object: metric.object,
        ...(metric.metric === undefined
          ? {}
          : { target: metric.metric, label: metric.metric.split("/").pop() }),
      });
      let open = true;
      const close = (status: RunStatus, error?: string) => {
        if (!open) return;
        open = false;
        this.end(ref.mapPath, trace, status, {
          ms: Date.parse(this.clock.now()) - startedAt,
          ...(error === undefined ? {} : { error }),
        });
      };
      const subscription = this.plugins.call(ref, plugin, method, args, trace).subscribe({
        next: (value) => {
          close("success");
          sink.next(value);
        },
        error: (error: unknown) => {
          close("failure", errorText(error));
          sink.error(error);
        },
        complete: () => {
          close("success");
          sink.complete();
        },
      });
      return () => {
        close("stopped", "остановлен");
        subscription.unsubscribe();
      };
    });
  }

  /**
   * Форма экшона: `inputs`, если написаны, иначе параметры метода по схеме из самоописания
   * плагина. Ради схемы процесс плагина поднимается — как на вызов.
   */
  private async form(ref: MapRef, action: MapAction) {
    const { config } = action;
    if (config.inputs !== undefined) return actionForm(config);
    const described = await this.plugins.describe(ref, config.plugin ?? "");
    const method = described.methods[config.method ?? ""];
    if (!method) throw new Error(`у плагина ${config.plugin} нет метода ${config.method}`);
    return actionForm(config, method.params);
  }

  /**
   * Запустить экшон: номер трейса — он же номер прогона — уходит сразу, вызов идёт у сервера.
   * Поля не прошли — трейса нет, в ответ уходят ошибки полей. `parent` — трейс, внутри которого
   * экшон запустили (агент экшона позвал `run_action`): тогда он идёт в нём же.
   */
  async start(
    ref: MapRef,
    address: string,
    given: Record<string, unknown> = {},
    source: RunSource = "ui",
    parent?: string,
  ): Promise<RunStarted> {
    // Экшон лежит у объекта, и адрес его называет: читается он, а не вся карта.
    const owner = memberOwner(address);
    const holder = owner === undefined ? undefined : await this.map.object(ref, owner);
    const found = holder && findActionOwner(holder, address);
    if (!found) throw new Error(`Экшон ${address} не найден`);
    const { action, object } = found;
    if (!action.config.plugin || !action.config.method) {
      throw new Error(`У экшона ${address} нет plugin и method`);
    }

    const { values, errors } = checkInputs(await this.form(ref, action), given);
    if (Object.keys(errors).length > 0) return { errors };

    const label = action.config.label ?? action.key;
    const trace = this.begin(ref.mapPath, {
      traceKind: "action",
      source,
      object: object.address,
      target: action.address,
      label,
      inputs: values,
      config: action.config,
      ...(parent === undefined ? {} : { parent }),
    });
    const startedAt = this.clock.now();
    const place = {
      mapPath: ref.mapPath,
      address: object.address,
      object: object.name,
      run: trace.trace,
      label,
    };
    this.activity?.actionStarted({ ...place, at: startedAt });

    let result: unknown;
    let finished = false;
    let resolve!: () => void;
    const done = new Promise<void>((ready) => {
      resolve = ready;
    });
    const finish = (status: RunStatus, error?: string) => {
      if (finished) return;
      finished = true;
      this.end(ref.mapPath, trace, status, {
        ms: Date.parse(this.clock.now()) - Date.parse(startedAt),
        ...(result === undefined ? {} : { result }),
        ...(error === undefined ? {} : { error }),
      });
      this.live.delete(trace.trace);
      this.activity?.actionEnded({ ...place, at: this.clock.now() }, status === "failure");
      resolve();
    };

    const { plugin = "", method = "" } = action.config;
    const subscription = this.plugins
      .call(ref, plugin, method, actionArgs(action.config, values), trace)
      .subscribe({
        next: (value) => {
          result = value;
        },
        error: (error: unknown) => finish("failure", errorText(error)),
        complete: () => finish("success"),
      });

    if (!finished) {
      this.live.set(trace.trace, {
        object: object.address,
        ...(parent === undefined ? {} : { parent }),
        done,
        // Остановка — отписка от вызова и всех вызовов трейса: плагины видят отмену и гасят своё.
        cancel: () => {
          if (finished) return;
          subscription.unsubscribe();
          this.plugins.cancelTrace(trace.trace);
          finish("stopped", "остановлен");
        },
      });
    }
    return { id: trace.trace };
  }

  /**
   * Остановить трейс по номеру: идущий экшон, все вызовы трейса, где бы они ни шли, и трейсы,
   * заведённые внутри него, — экшон, который агент экшона запустил через MCP.
   */
  stop(id: string): void {
    for (const [child, live] of this.live) if (live.parent === id) this.stop(child);
    const live = this.live.get(id);
    if (live) live.cancel();
    else this.plugins.cancelTrace(id);
  }

  /** Дождаться конца прогона: MCP и терминал зовут экшон ради итога. */
  async wait(mapPath: string, id: string): Promise<Run | undefined> {
    await this.live.get(id)?.done;
    return this.find(mapPath, id);
  }

  /** Прогон по номеру, собранный из строк его трейса. */
  async find(mapPath: string, id: string): Promise<Run | undefined> {
    const lines = await this.logs.read(mapPath, { trace: id }, RUN_LINES);
    return runsOf(lines, (trace) => this.live.has(trace), this.clock.now()).find(
      (run) => run.id === id,
    );
  }

  /** Прогоны объекта, свежие сверху: строки его трейсов, потоком. */
  watch(mapPath: string, object: string): Observable<Run[]> {
    return this.logs
      .watch(mapPath, { object }, RUN_LINES)
      .pipe(mapStream((lines) => runsOf(lines, (trace) => this.live.has(trace), this.clock.now())));
  }
}
