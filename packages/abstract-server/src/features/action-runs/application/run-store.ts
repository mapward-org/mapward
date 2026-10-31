import { Observable, Subject, type Subscription } from "rxjs";
import {
  actionArgs,
  actionForm,
  checkInputs,
  findActionOwner,
  memberOwner,
  runMessage,
} from "@mapward/core";
import type { MapAction, Run, RunSource, RunStarted, RunStatus, RunStep } from "@mapward/core";
import type { ClockPort, FileReader, FileWriter, TimersPort } from "../../../ports/index.ts";
import type { MapRef } from "../../../kernel/map-ref.ts";
import { join } from "../../../lib/path.ts";
import { orphaned, RUNS_DIR, runsFile, trim } from "../domain/history.ts";
import type { RunsActivity, RunsMapSource, RunsPlugins } from "../ports.ts";

type Control = { cancel: () => void; done: Promise<Run> };

type MapRuns = {
  runs: Run[];
  /** Объекты, чьи прогоны уже подняты с диска. */
  loaded: Map<string, Promise<void>>;
  controls: Map<string, Control>;
};

const dir = (mapPath: string) => join(mapPath, RUNS_DIR);

/** Предел вывода шага: история хранится целиком, а дерево файлов раздуло бы её (решение 0038). */
const OUTPUT_LIMIT = 200_000;

/**
 * Как часто уходит растущий лог. Подписчик получает прогоны объекта целиком, и болтливый скрипт
 * гонял бы их через мост на каждой строке — поэтому строки копятся и уходят пачкой.
 */
const OUTPUT_FLUSH_MS = 250;

export function capped(text: string | undefined): string | undefined {
  if (text === undefined || text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT)}\n… отрезано ${text.length - OUTPUT_LIMIT} знаков`;
}

/** Итог метода — под тем же пределом: огромный итог остаётся в прогоне строкой о себе. */
function cappedValue(value: unknown): unknown {
  const text = JSON.stringify(value) ?? "";
  return text.length <= OUTPUT_LIMIT ? value : `итог в ${text.length} знаков не сохранён`;
}

/**
 * Хранилище прогонов — решение 0038. Прогон — вызов метода плагина через экшон: платформа его
 * маршрутизирует и записывает вызов, сообщения о ходе и итог. Метрики подписаны на плагины сами
 * и обновятся без просьбы.
 *
 * Живут прогоны у сервера и на диске карты, в `.mapward/runs/`: это операционка, у каждого своя,
 * и в git она не попадает — там `.gitignore` со звёздочкой.
 *
 * Прогоны одного экшона идут параллельно: у экшона параметры, и запустить его на разные значения
 * разом — обычное дело. Поэтому у каждого запуска свой номер, свой лог и своя остановка.
 */
export class RunStore {
  private readonly maps = new Map<string, MapRuns>();
  private readonly changes = new Subject<string>();
  private counter = 0;
  /** Карты, у которых вывод уже ждёт отправки пачкой. */
  private readonly flushing = new Set<string>();

  constructor(
    private readonly files: FileReader & FileWriter,
    private readonly map: RunsMapSource,
    /** Экшон — метод плагина: через них он и зовётся, и описывает свою форму. */
    private readonly plugins: RunsPlugins,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
    /** Лента в кружке: идущие и упавшие экшоны видно по всей карте, откуда бы их ни запустили. */
    private readonly activity?: RunsActivity,
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

  /**
   * Кусок вывода идущего шага. Копится в памяти, на диск прогон по-прежнему пишется на
   * границах шагов; подписчикам уходит пачкой, не чаще раза в {@link OUTPUT_FLUSH_MS}.
   */
  private stepOutput(mapPath: string, step: RunStep, chunk: string, stream: "out" | "err"): void {
    if (step.status !== "running" || chunk === "") return;
    if (stream === "out") step.output = capped((step.output ?? "") + chunk);
    else step.log = capped((step.log ?? "") + chunk);
    if (this.flushing.has(mapPath)) return;
    this.flushing.add(mapPath);
    this.timers.after(OUTPUT_FLUSH_MS, () => {
      this.flushing.delete(mapPath);
      this.changes.next(mapPath);
    });
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

  /** Имя шага, пока метод своих шагов не назвал: плагин и метод. */
  private static stepName(action: MapAction): string {
    const plugin = (action.config.plugin ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
    return [plugin, action.config.method].filter(Boolean).join(".");
  }

  /**
   * Вызов метода через экшон: сообщения о ходе — в шаги прогона, остальное — итог. Платформа
   * маршрутизирует вызов и пишет историю; сам плагин о ней не знает.
   */
  private execute(
    ref: MapRef,
    run: Run,
    action: MapAction,
    args: Record<string, unknown>,
  ): { done: Promise<Run>; cancel: () => void } {
    const mapPath = ref.mapPath;
    let step: RunStep | undefined;
    let finished = false;
    let resolve!: (run: Run) => void;
    const done = new Promise<Run>((ready) => {
      resolve = ready;
    });

    const current = () => (step ??= this.stepStart(mapPath, run, RunStore.stepName(action)));
    const finish = (status: RunStatus, error?: string) => {
      if (finished) return;
      finished = true;
      if (step?.status === "running") {
        this.stepEnd(mapPath, step, status, step.log || !error ? {} : { log: error });
      }
      void this.end(mapPath, run, status, error).then(() => resolve(run));
    };

    const { plugin = "", method = "" } = action.config;
    const subscription: Subscription = this.plugins.call(ref, plugin, method, args).subscribe({
      next: (value) => {
        if (finished) return;
        const message = runMessage(value);
        if (!message) {
          run.result = cappedValue(value);
          this.changes.next(mapPath);
          return;
        }
        if (message.progress === "step") {
          if (step?.status === "running") this.stepEnd(mapPath, step, "success");
          step = this.stepStart(mapPath, run, message.name);
          return;
        }
        const stream = message.progress === "out" ? "out" : "err";
        this.stepOutput(mapPath, current(), `${message.text}\n`, stream);
      },
      error: (error: unknown) =>
        finish("failure", error instanceof Error ? error.message : String(error)),
      complete: () => finish("success"),
    });

    return {
      done,
      // Остановка — отписка от вызова: плагин видит отмену и гасит своё.
      cancel: () => {
        if (finished) return;
        subscription.unsubscribe();
        finish("stopped", "остановлен");
      },
    };
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
   * Запустить экшон: номер уходит сразу, прогон идёт у сервера. Поля не прошли — прогона нет,
   * в ответ уходят ошибки полей: их показывает форма, а MCP и терминал печатают.
   */
  async start(
    ref: MapRef,
    address: string,
    given: Record<string, unknown> = {},
    source: RunSource = "ui",
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

    const place = {
      mapPath: ref.mapPath,
      address: object.address,
      object: object.name,
      run: run.id,
      label: run.label,
    };
    this.activity?.actionStarted({ ...place, at: run.startedAt });

    const { done, cancel } = this.execute(ref, run, action, actionArgs(action.config, values));
    this.stateOf(ref.mapPath).controls.set(run.id, {
      cancel,
      done: done.finally(() => {
        this.stateOf(ref.mapPath).controls.delete(run.id);
        this.activity?.actionEnded(
          { ...place, at: run.finishedAt ?? this.clock.now() },
          run.status === "failure",
        );
      }),
    });
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
}
