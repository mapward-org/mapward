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
import type { ServerPorts } from "../../../ports/index.ts";
import { createCancellation, type Cancellation } from "../../../lib/cancellation.ts";
import { join } from "../../../lib/path.ts";
import { objectEnv } from "../../map-object/domain/agent.ts";
import { runPrompt, runScript } from "../../map-object/application/use-cases/execute.ts";
import { checkInputs, fillInputs, inputEnv } from "../domain/inputs.ts";
import { orphaned, RUNS_DIR, runsFile, trim } from "../domain/history.ts";

export type MapRef = { mapPath: string; basePath: string; name: string };

/** Что прогону нужно от остального сервера: карта и пересборка метрик после успеха. */
export type RunDeps = {
  readMap: (ref: MapRef) => Promise<MapObject>;
  runMetric: (ref: MapRef, address: string) => Promise<unknown>;
};

/**
 * Запись прогона метрики: стор метрик сообщает, что стадия началась и кончилась, а хранит и
 * показывает прогон это хранилище. Так история метрик и экшонов — одна (решение 0038).
 */
export type RunRecorder = {
  step(name: string): void;
  stepDone(status: RunStatus, log?: string): void;
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

/**
 * Хранилище прогонов — решение 0038. Живут они у сервера и на диске карты, в `.mapward/runs/`:
 * это операционка, у каждого своя, и в git она не попадает — там `.gitignore` со звёздочкой.
 *
 * Прогоны одного экшона идут параллельно: у экшона параметры, и запустить его на разные значения
 * разом — обычное дело. Поэтому у каждого запуска свой номер, свой лог и своя остановка.
 */
export function createRunStore(ports: ServerPorts, deps: RunDeps) {
  const maps = new Map<string, MapRuns>();
  const changes = new Subject<string>();
  let counter = 0;

  const stateOf = (mapPath: string): MapRuns => {
    const existing = maps.get(mapPath);
    if (existing) return existing;
    const created: MapRuns = { runs: [], loaded: new Map(), controls: new Map() };
    maps.set(mapPath, created);
    return created;
  };

  /** Прогоны объекта с диска — один раз на объект. Файла нет или он битый — прогонов нет. */
  function load(mapPath: string, object: string): Promise<void> {
    const state = stateOf(mapPath);
    const existing = state.loaded.get(object);
    if (existing) return existing;
    const loading = (async () => {
      const text = await ports.files.read(join(dir(mapPath), runsFile(object)));
      if (text === undefined) return;
      try {
        const saved = JSON.parse(text) as Run[];
        const now = ports.clock.now();
        const known = new Set(state.runs.map((run) => run.id));
        state.runs.push(...saved.filter((run) => !known.has(run.id)).map((r) => orphaned(r, now)));
        changes.next(mapPath);
      } catch {
        // Битый файл — не повод падать экрану: прогоны локальные, их потеря ничего не ломает.
      }
    })();
    state.loaded.set(object, loading);
    return loading;
  }

  async function persist(mapPath: string, object: string): Promise<void> {
    const state = stateOf(mapPath);
    state.runs = trim(state.runs);
    const mine = state.runs.filter((run) => run.object === object && run.status !== "running");
    const root = dir(mapPath);
    // Звёздочка внутри самой папки: корневой `.gitignore` человеку править не нужно.
    const ignore = join(mapPath, ".mapward", ".gitignore");
    if ((await ports.files.read(ignore)) === undefined) await ports.files.write(ignore, "*\n");
    await ports.files.write(join(root, runsFile(object)), JSON.stringify(mine, null, 2) + "\n");
  }

  const nextId = () => `${Date.parse(ports.clock.now()).toString(36)}-${(++counter).toString(36)}`;

  function begin(mapPath: string, run: Omit<Run, "id" | "status" | "startedAt" | "steps">): Run {
    const created: Run = {
      ...run,
      id: nextId(),
      status: "running",
      startedAt: ports.clock.now(),
      steps: [],
    };
    stateOf(mapPath).runs.unshift(created);
    changes.next(mapPath);
    return created;
  }

  function stepStart(mapPath: string, run: Run, name: string): RunStep {
    const step: RunStep = { name, status: "running", startedAt: ports.clock.now() };
    run.steps.push(step);
    changes.next(mapPath);
    return step;
  }

  function stepEnd(
    mapPath: string,
    step: RunStep,
    status: RunStatus,
    texts: { log?: string; output?: string } = {},
  ): void {
    step.status = status;
    step.finishedAt = ports.clock.now();
    if (texts.log) step.log = texts.log;
    if (texts.output) step.output = texts.output;
    changes.next(mapPath);
  }

  async function end(mapPath: string, run: Run, status: RunStatus, error?: string): Promise<void> {
    run.status = status;
    run.finishedAt = ports.clock.now();
    if (error) run.error = error;
    changes.next(mapPath);
    await persist(mapPath, run.object);
  }

  /** Один исполнитель экшона. Неизвестный вид — ошибка шага: вид мог появиться позже карты. */
  async function runner(
    ref: MapRef,
    spec: Record<string, unknown>,
    object: MapObject,
    values: Record<string, unknown>,
    cancel: Cancellation,
  ): Promise<{ output: string; log: string }> {
    const env = { ...objectEnv(object, ref.mapPath, ports.env.vars()), ...inputEnv(values) };

    switch (spec.kind) {
      case "script": {
        // Данные формы — JSON во входе и переменными: скрипт берёт то, что ему удобнее.
        const { stdout, stderr } = await runScript(ports, {
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
        const { stdout, stderr } = await runPrompt(ports, {
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

  async function execute(
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
        const step = stepStart(ref.mapPath, run, String(spec.name ?? spec.kind ?? at + 1));
        try {
          // По порядку: следующий шаг идёт после того, как предыдущий сделал своё.
          // oxlint-disable-next-line no-await-in-loop
          const result = await runner(ref, spec, object, values, token);
          stepEnd(ref.mapPath, step, "success", result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          stepEnd(ref.mapPath, step, token.cancelled ? "stopped" : "failure", { log: message });
          throw error;
        }
      }
      await end(ref.mapPath, run, "success");
      // Экшон пишет, метрики читают (решение 0038): что он сделал, видно в них, и старое
      // значение рядом со свежим запуском висеть не должно.
      for (const key of action.config.refreshes ?? []) {
        void deps
          .runMetric(ref, `${childAddress(object.address, "_metrics")}/${key}`)
          .catch(() => {});
      }
    } catch (error) {
      const limit = expired();
      if (limit !== undefined) {
        await end(ref.mapPath, run, "failure", `время вышло, предел ${limit} мс`);
      } else if (token.cancelled) {
        await end(ref.mapPath, run, "stopped", "остановлен");
      } else {
        await end(
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
  async function start(
    ref: MapRef,
    address: string,
    given: Record<string, unknown> = {},
    source: RunSource = "ui",
  ): Promise<RunStarted> {
    const map = await deps.readMap(ref);
    const found = findActionOwner(map, address);
    if (!found) throw new Error(`Экшон ${address} не найден`);
    const { action, object } = found;

    const { values, errors } = checkInputs(action.config.inputs, given);
    if (Object.keys(errors).length > 0) return { errors };

    await load(ref.mapPath, object.address);
    const run = begin(ref.mapPath, {
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
        : ports.timers.after(timeout, () => {
            limit = timeout;
            cancel();
          });

    const done = execute(ref, run, action, object, values, token, () => limit).finally(() => {
      stopTimer();
      stateOf(ref.mapPath).controls.delete(run.id);
    });
    stateOf(ref.mapPath).controls.set(run.id, { cancel, done });
    return { id: run.id };
  }

  /** Остановить по номеру. Прогона нет или он кончился — делать нечего, и это не ошибка. */
  function stop(mapPath: string, id: string): void {
    stateOf(mapPath).controls.get(id)?.cancel();
  }

  /** Дождаться конца прогона: MCP и терминал зовут экшон ради итога. */
  async function wait(mapPath: string, id: string): Promise<Run | undefined> {
    const control = stateOf(mapPath).controls.get(id);
    if (control) return control.done;
    return stateOf(mapPath).runs.find((run) => run.id === id);
  }

  const find = (mapPath: string, id: string) => stateOf(mapPath).runs.find((run) => run.id === id);

  /** Прогоны объекта, свежие сверху. Подписка сразу получает то, что есть, потом изменения. */
  function watch(mapPath: string, object: string): Observable<Run[]> {
    return new Observable<Run[]>((subscriber) => {
      const push = () =>
        subscriber.next(
          trim(stateOf(mapPath).runs)
            .filter((run) => run.object === object)
            // Копия: подписчик по ту сторону моста не должен видеть, как запись меняется на месте.
            .map((run) => JSON.parse(JSON.stringify(run)) as Run),
        );
      const subscription = changes.subscribe((changed) => {
        if (changed === mapPath) push();
      });
      void load(mapPath, object).then(push);
      return () => subscription.unsubscribe();
    });
  }

  /** Прогон метрики: стадии сообщает стор метрик, храним и показываем здесь. */
  function recordMetric(
    mapPath: string,
    info: { target: string; object: string; label: string; source: RunSource; config: unknown },
  ): RunRecorder {
    void load(mapPath, info.object);
    const run = begin(mapPath, { kind: "metric", ...info });
    return {
      step: (name) => void stepStart(mapPath, run, name),
      stepDone: (status, log) => {
        const step = lastStep(run);
        if (step?.status === "running") stepEnd(mapPath, step, status, log ? { log } : {});
      },
      end: (status, error) => void end(mapPath, run, status, error),
    };
  }

  return { start, stop, wait, find, watch, recordMetric };
}

export type RunStore = ReturnType<typeof createRunStore>;
