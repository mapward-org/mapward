import { Observable, Subject } from "rxjs";
import { childAddress, findActionOwner } from "@mapward/core";
import type {
  ActionPermissions,
  MapAction,
  MapObject,
  Run,
  RunSource,
  RunStarted,
  RunStatus,
  RunStep,
} from "@mapward/core";
import type {
  ClockPort,
  EnvPort,
  FileReader,
  FileWriter,
  TimersPort,
} from "../../../ports/index.ts";
import type { MapRef } from "../../../kernel/map-ref.ts";
import { objectEnv } from "../../../kernel/object-env.ts";
import { createCancellation, type Cancellation } from "../../../lib/cancellation.ts";
import { join } from "../../../lib/path.ts";
import { checkInputs, fillInputs, inputEnv } from "../domain/inputs.ts";
import { orphaned, RUNS_DIR, runsFile, trim } from "../domain/history.ts";
import type { RunsExecutor, RunsMapSource, RunsMetricRefresh } from "../ports.ts";

/**
 * Запись прогона метрики: стор метрик сообщает, что стадия началась и кончилась, а хранит и
 * показывает прогон это хранилище. Так история метрик и экшонов — одна (решение 0038).
 */
export type RunRecorder = {
  step(name: string): void;
  /** `output` — результат стадии; в шаг он ложится JSON-ом, обрезанный до предела. */
  stepDone(status: RunStatus, log?: string, output?: unknown): void;
  end(status: RunStatus, error?: string): void;
};

type Control = { cancel: () => void; done: Promise<Run> };

type MapRuns = {
  runs: Run[];
  /** Объекты, чьи прогоны уже подняты с диска. */
  loaded: Map<string, Promise<void>>;
  controls: Map<string, Control>;
};

const dir = (mapPath: string) => join(mapPath, RUNS_DIR);

const lastStep = (run: Run): RunStep | undefined => run.steps.at(-1);

/** Предел вывода шага: история хранится целиком, а дерево файлов раздуло бы её (решение 0038). */
const OUTPUT_LIMIT = 200_000;

export function capped(text: string | undefined): string | undefined {
  if (text === undefined || text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT)}\n… отрезано ${text.length - OUTPUT_LIMIT} знаков`;
}

/**
 * Хранилище прогонов — решение 0038. Живут они у сервера и на диске карты, в `.mapward/runs/`:
 * это операционка, у каждого своя, и в git она не попадает — там `.gitignore` со звёздочкой.
 *
 * Прогоны одного экшона идут параллельно: у экшона параметры, и запустить его на разные значения
 * разом — обычное дело. Поэтому у каждого запуска свой номер, свой лог и своя остановка.
 */
export class RunStore {
  private readonly maps = new Map<string, MapRuns>();
  private readonly changes = new Subject<string>();
  private counter = 0;

  constructor(
    private readonly files: FileReader & FileWriter,
    private readonly executor: RunsExecutor,
    private readonly map: RunsMapSource,
    /** Экшон пишет, метрики читают: после успеха он просит пересобрать названные метрики. */
    private readonly metrics: RunsMetricRefresh,
    private readonly env: EnvPort,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
  ) {}

  private stateOf(mapPath: string): MapRuns {
    const existing = this.maps.get(mapPath);
    if (existing) return existing;
    const created: MapRuns = { runs: [], loaded: new Map(), controls: new Map() };
    this.maps.set(mapPath, created);
    return created;
  }

  /** Прогоны объекта с диска — один раз на объект. Файла нет или он битый — прогонов нет. */
  private load(mapPath: string, object: string): Promise<void> {
    const state = this.stateOf(mapPath);
    const existing = state.loaded.get(object);
    if (existing) return existing;
    const loading = (async () => {
      const text = await this.files.read(join(dir(mapPath), runsFile(object)));
      if (text === undefined) return;
      try {
        const saved = JSON.parse(text) as Run[];
        const now = this.clock.now();
        const known = new Set(state.runs.map((run) => run.id));
        state.runs.push(...saved.filter((run) => !known.has(run.id)).map((r) => orphaned(r, now)));
        this.changes.next(mapPath);
      } catch {
        // Битый файл — не повод падать экрану: прогоны локальные, их потеря ничего не ломает.
      }
    })();
    state.loaded.set(object, loading);
    return loading;
  }

  private async persist(mapPath: string, object: string): Promise<void> {
    const state = this.stateOf(mapPath);
    state.runs = trim(state.runs);
    const mine = state.runs.filter((run) => run.object === object && run.status !== "running");
    const root = dir(mapPath);
    // Звёздочка внутри самой папки: корневой `.gitignore` человеку править не нужно.
    const ignore = join(mapPath, ".mapward", ".gitignore");
    if ((await this.files.read(ignore)) === undefined) await this.files.write(ignore, "*\n");
    await this.files.write(join(root, runsFile(object)), JSON.stringify(mine, null, 2) + "\n");
  }

  private nextId(): string {
    return `${Date.parse(this.clock.now()).toString(36)}-${(++this.counter).toString(36)}`;
  }

  private begin(mapPath: string, run: Omit<Run, "id" | "status" | "startedAt" | "steps">): Run {
    const created: Run = {
      ...run,
      id: this.nextId(),
      status: "running",
      startedAt: this.clock.now(),
      steps: [],
    };
    this.stateOf(mapPath).runs.unshift(created);
    this.changes.next(mapPath);
    return created;
  }

  private stepStart(mapPath: string, run: Run, name: string): RunStep {
    const step: RunStep = { name, status: "running", startedAt: this.clock.now() };
    run.steps.push(step);
    this.changes.next(mapPath);
    return step;
  }

  private stepEnd(
    mapPath: string,
    step: RunStep,
    status: RunStatus,
    texts: { log?: string; output?: string } = {},
  ): void {
    step.status = status;
    step.finishedAt = this.clock.now();
    if (texts.log) step.log = texts.log;
    if (texts.output) step.output = texts.output;
    this.changes.next(mapPath);
  }

  private async end(mapPath: string, run: Run, status: RunStatus, error?: string): Promise<void> {
    run.status = status;
    run.finishedAt = this.clock.now();
    if (error) run.error = error;
    this.changes.next(mapPath);
    await this.persist(mapPath, run.object);
  }

  /** Один исполнитель экшона. Неизвестный вид — ошибка шага: вид мог появиться позже карты. */
  private async runner(
    ref: MapRef,
    spec: Record<string, unknown>,
    object: MapObject,
    values: Record<string, unknown>,
    cancel: Cancellation,
  ): Promise<{ output: string; log: string }> {
    const env = { ...objectEnv(object, ref.mapPath, this.env.vars()), ...inputEnv(values) };

    switch (spec.kind) {
      case "script": {
        // Данные формы — JSON во входе и переменными: скрипт берёт то, что ему удобнее.
        const { stdout, stderr } = await this.executor.script({
          command: fillInputs(String(spec.run), values),
          cwd: ref.mapPath,
          env,
          input: JSON.stringify(values),
          cancel,
        });
        return { output: stdout, log: stderr };
      }
      case "prompt": {
        const form =
          Object.keys(values).length === 0
            ? undefined
            : `Данные формы, с которыми запустили экшон: ${JSON.stringify(values)}`;
        const permissions = spec.permissions as ActionPermissions | undefined;
        const { stdout, stderr } = await this.executor.prompt({
          owner: object,
          text: fillInputs(String(spec.prompt), values),
          ...(form === undefined ? {} : { tail: form }),
          // Агент экшона работает с проектом, а не с картой: директива или релиз трогают код.
          cwd: ref.basePath,
          env,
          cancel,
          ...(permissions === undefined ? {} : { permissions }),
        });
        return { output: stdout, log: stderr };
      }
      default:
        throw new Error(`Исполнитель ${String(spec.kind)} ещё не поддержан`);
    }
  }

  private async execute(
    ref: MapRef,
    run: Run,
    action: MapAction,
    object: MapObject,
    values: Record<string, unknown>,
    token: Cancellation,
    expired: () => number | undefined,
  ): Promise<Run> {
    const specs = action.config.runners ?? [];
    try {
      if (specs.length === 0) throw new Error("у экшона нет ни одного исполнителя");
      for (const [at, spec] of specs.entries()) {
        const step = this.stepStart(ref.mapPath, run, String(spec.name ?? spec.kind ?? at + 1));
        try {
          // По порядку: следующий шаг идёт после того, как предыдущий сделал своё.
          // oxlint-disable-next-line no-await-in-loop
          const result = await this.runner(ref, spec, object, values, token);
          this.stepEnd(ref.mapPath, step, "success", {
            log: result.log,
            output: capped(result.output),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.stepEnd(ref.mapPath, step, token.cancelled ? "stopped" : "failure", {
            log: message,
          });
          throw error;
        }
      }
      await this.end(ref.mapPath, run, "success");
      // Экшон пишет, метрики читают (решение 0038): что он сделал, видно в них, и старое
      // значение рядом со свежим запуском висеть не должно.
      for (const key of action.config.refreshes ?? []) {
        void this.metrics
          .run(ref, `${childAddress(object.address, "_metrics")}/${key}`)
          .catch(() => {});
      }
    } catch (error) {
      const limit = expired();
      if (limit !== undefined) {
        await this.end(ref.mapPath, run, "failure", `время вышло, предел ${limit} мс`);
      } else if (token.cancelled) {
        await this.end(ref.mapPath, run, "stopped", "остановлен");
      } else {
        await this.end(
          ref.mapPath,
          run,
          "failure",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return run;
  }

  /**
   * Запустить экшон: номер уходит сразу, прогон идёт у сервера. Поля не прошли — прогона нет,
   * в ответ уходят ошибки полей: их показывает форма, а MCP и терминал печатают.
   */
  async start(
    ref: MapRef,
    address: string,
    given: Record<string, unknown> = {},
    source: RunSource = "ui",
  ): Promise<RunStarted> {
    const map = await this.map.current(ref);
    const found = findActionOwner(map, address);
    if (!found) throw new Error(`Экшон ${address} не найден`);
    const { action, object } = found;

    const { values, errors } = checkInputs(action.config.inputs, given);
    if (Object.keys(errors).length > 0) return { errors };

    await this.load(ref.mapPath, object.address);
    const run = this.begin(ref.mapPath, {
      kind: "action",
      target: action.address,
      object: object.address,
      label: action.config.label ?? action.key,
      source,
      inputs: values,
      config: action.config,
    });

    const { token, cancel } = createCancellation();
    let limit: number | undefined;
    const timeout = action.config.timeout;
    const stopTimer =
      timeout === undefined
        ? () => {}
        : this.timers.after(timeout, () => {
            limit = timeout;
            cancel();
          });

    const done = this.execute(ref, run, action, object, values, token, () => limit).finally(() => {
      stopTimer();
      this.stateOf(ref.mapPath).controls.delete(run.id);
    });
    this.stateOf(ref.mapPath).controls.set(run.id, { cancel, done });
    return { id: run.id };
  }

  /** Остановить по номеру. Прогона нет или он кончился — делать нечего, и это не ошибка. */
  stop(mapPath: string, id: string): void {
    this.stateOf(mapPath).controls.get(id)?.cancel();
  }

  /** Дождаться конца прогона: MCP и терминал зовут экшон ради итога. */
  async wait(mapPath: string, id: string): Promise<Run | undefined> {
    const control = this.stateOf(mapPath).controls.get(id);
    if (control) return control.done;
    return this.stateOf(mapPath).runs.find((run) => run.id === id);
  }

  find(mapPath: string, id: string): Run | undefined {
    return this.stateOf(mapPath).runs.find((run) => run.id === id);
  }

  /** Прогоны объекта, свежие сверху. Подписка сразу получает то, что есть, потом изменения. */
  watch(mapPath: string, object: string): Observable<Run[]> {
    return new Observable<Run[]>((subscriber) => {
      const push = () =>
        subscriber.next(
          trim(this.stateOf(mapPath).runs)
            .filter((run) => run.object === object)
            // Копия: подписчик по ту сторону моста не должен видеть, как запись меняется на месте.
            .map((run) => JSON.parse(JSON.stringify(run)) as Run),
        );
      const subscription = this.changes.subscribe((changed) => {
        if (changed === mapPath) push();
      });
      void this.load(mapPath, object).then(push);
      return () => subscription.unsubscribe();
    });
  }

  /**
   * Прогон метрики: стадии сообщает стор метрик, храним и показываем здесь. Отмену он отдаёт
   * вместе с записью — иначе «остановить» у прогона метрики было бы нечем исполнить.
   */
  recordMetric(
    mapPath: string,
    info: { target: string; object: string; label: string; source: RunSource; config: unknown },
    cancel?: () => void,
  ): RunRecorder {
    void this.load(mapPath, info.object);
    const run = this.begin(mapPath, { kind: "metric", ...info });
    let finish: ((value: Run) => void) | undefined;
    const done = new Promise<Run>((resolve) => {
      finish = resolve;
    });
    if (cancel) this.stateOf(mapPath).controls.set(run.id, { cancel, done });
    return {
      step: (name) => void this.stepStart(mapPath, run, name),
      stepDone: (status, log, output) => {
        const step = lastStep(run);
        if (step?.status !== "running") return;
        this.stepEnd(mapPath, step, status, {
          ...(log ? { log } : {}),
          ...(output === undefined ? {} : { output: capped(JSON.stringify(output, null, 2)) }),
        });
      },
      end: (status, error) => {
        this.stateOf(mapPath).controls.delete(run.id);
        void this.end(mapPath, run, status, error).then(() => finish?.(run));
      },
    };
  }
}
