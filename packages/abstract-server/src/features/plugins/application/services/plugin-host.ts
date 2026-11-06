import {
  Observable,
  distinctUntilChanged,
  throwError,
  map as mapStream,
  type Subscriber,
  type Subscription,
} from "rxjs";
import type {
  PlatformMessage,
  PluginDescription,
  PluginMessage,
  PluginRequest,
} from "@mapward/plugin";
import type {
  ClockPort,
  EditorPort,
  EnvPort,
  FileWatcher,
  PluginProcess,
  PluginProcessPort,
  TimersPort,
  TrustPort,
  WebviewPort,
} from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import type { LogLine, TraceRef } from "@mapward/core";
import { debounce } from "@mapward/vfs";
import { message } from "../../../../lib/bundle.ts";
import type { PluginsLogs, PluginsMapEdits, PluginsMapSource } from "../../ports.ts";
import { instanceKey, toPluginObject } from "../../domain/plugin-object.ts";
import type { BuildPlugin } from "../use-cases/build-plugin.ts";
import type { InstallPlugin } from "../use-cases/install-plugin.ts";

/**
 * Вызов, который ждёт ответа: при перезапуске плагина он уходит в новый процесс заново. Трейс у
 * него есть всегда — названный зовущим или свой.
 */
type Call = {
  method: string;
  args: unknown;
  sink: Subscriber<unknown>;
  id?: string;
  trace: TraceRef;
  /** Когда ушёл в процесс — для длительности в строке конца. */
  sentAt?: number;
  instance?: Instance;
};

type Instance = {
  ref: MapRef;
  plugin: string;
  process?: PluginProcess;
  description?: PluginDescription;
  ready: Promise<PluginDescription>;
  calls: Set<Call>;
  byId: Map<string, Call>;
  /** Просьбы плагина к платформе: модель карты, другие плагины, редактор. */
  requests: Map<string, Subscription>;
  stopping: boolean;
  stopIdle: () => void;
  stopWatch: () => void;
  /** Хвост stderr, когда логов у хоста нет: падение без него ничего не объясняет. */
  log: string[];
  /** Имя файла лога плагина. */
  file: string;
};

/** Сколько ждать `dispose` после просьбы остановиться, прежде чем убить. */
const GRACE_MS = 5_000;
/** Простой по умолчанию: пять минут без вызовов — и процесс гаснет. */
const IDLE_MS = 5 * 60_000;
/** Правка кода пишет файлы пачкой: перезапуск — по тишине. */
const QUIET_MS = 300;
const LOG_LINES = 40;

const noop = () => {};

/**
 * Плагина по пути нет вовсе. Отдельный вид ошибки: тот, кто ищет плагин, получает перечень
 * встроенных — скорее всего, нужен один из них.
 */
export class PluginMissing extends Error {
  constructor(
    readonly plugin: string,
    readonly builtins: string[],
  ) {
    super(
      `плагина ${plugin} нет: в папке нет index.ts. Встроенные плагины: ${builtins.join(", ")}`,
    );
    this.name = "PluginMissing";
  }
}

/**
 * Процессы плагинов: один на плагин на карту. Поднимается на первое обращение, гаснет после
 * простоя, перезапускается при правке своего кода — вызовы, которые его ждут, уходят в новый
 * процесс сами, и метрика на экране этого не замечает.
 *
 * Платформа не навязывает ни таймаутов, ни очередей: за скорость отвечает плагин.
 */
export class PluginHost {
  private readonly instances = new Map<string, Instance>();
  private counter = 0;

  constructor(
    private readonly map: PluginsMapSource,
    private readonly build: BuildPlugin,
    private readonly install: InstallPlugin,
    private readonly watcher: FileWatcher,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
    private readonly env: EnvPort,
    private readonly processes: PluginProcessPort | undefined,
    private readonly trust: TrustPort | undefined,
    private readonly editor: EditorPort | undefined,
    /** Клиент карты для плагинов — `ctx.webview`; спрашивается на старте каждого процесса. */
    private readonly webview: WebviewPort | undefined = undefined,
    /** Правка карты — `ctx.editMap`; без неё просьба плагина получает отказ. */
    private readonly edits: PluginsMapEdits | undefined = undefined,
    /** Логи карты: строки вызовов, `ctx.log` и stderr плагина. Без них хост пишет никуда. */
    private readonly logs: PluginsLogs | undefined = undefined,
  ) {}

  /** Номер, уникальный и между окнами: строки прошлых запусков лежат в тех же файлах. */
  nextId(prefix: string): string {
    return `${prefix}${Date.parse(this.clock.now()).toString(36)}-${(++this.counter).toString(36)}`;
  }

  /**
   * Вызов метода плагина. Отписка — это отмена: плагин видит её и гасит своё. Трейс называет
   * зовущий; не назвал — вызов заводит свой.
   */
  call(
    ref: MapRef,
    plugin: string,
    method: string,
    args: unknown,
    trace?: TraceRef,
  ): Observable<unknown> {
    return new Observable<unknown>((sink) => {
      const call: Call = { method, args, sink, trace: trace ?? { trace: this.nextId("t") } };
      const instance = this.instanceOf(ref, plugin);
      this.attach(instance, call);
      return () => this.detach(call);
    });
  }

  /**
   * Снять все идущие вызовы трейса, вложенные тоже: зовущие получают отказ «остановлен», а
   * процессы плагинов — отмену своих вызовов.
   */
  cancelTrace(trace: string): void {
    for (const instance of this.instances.values()) {
      for (const call of instance.calls) {
        if (call.trace.trace !== trace) continue;
        this.detach(call);
        call.sink.error(new Error("остановлен"));
      }
    }
  }

  /** Первое значение или отказ по сроку: срок называет зовущий, у платформы своего нет. */
  first(
    ref: MapRef,
    plugin: string,
    method: string,
    args: unknown,
    timeout: number,
    trace?: TraceRef,
  ): Promise<unknown> {
    return this.collect(ref, plugin, method, args, timeout, true, trace).then(
      (values) => values[0],
    );
  }

  /** Все значения до конца потока или отказ по сроку. */
  all(
    ref: MapRef,
    plugin: string,
    method: string,
    args: unknown,
    timeout: number,
    trace?: TraceRef,
  ): Promise<unknown[]> {
    return this.collect(ref, plugin, method, args, timeout, false, trace);
  }

  private collect(
    ref: MapRef,
    plugin: string,
    method: string,
    args: unknown,
    timeout: number,
    once: boolean,
    trace?: TraceRef,
  ): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve, reject) => {
      const values: unknown[] = [];
      let done = false;
      let subscription: Subscription | undefined;
      const finish = (run: () => void) => {
        if (done) return;
        done = true;
        stopTimer();
        // Ответ мог прийти прямо в `subscribe`, когда подписки ещё нет.
        void Promise.resolve().then(() => subscription?.unsubscribe());
        run();
      };
      const stopTimer = this.timers.after(timeout, () =>
        finish(() =>
          reject(
            new Error(
              once
                ? `плагин не ответил за ${timeout} мс`
                : `плагин не закончил за ${timeout} мс; пришло значений: ${values.length}`,
            ),
          ),
        ),
      );
      subscription = this.call(ref, plugin, method, args, trace).subscribe({
        next: (value) => {
          values.push(value);
          if (once) finish(() => resolve(values));
        },
        error: (error: unknown) => finish(() => reject(error)),
        complete: () => finish(() => resolve(values)),
      });
    });
  }

  /** Самоописание: методы и схемы. Ради него процесс поднимается, как на вызов. */
  async describe(ref: MapRef, plugin: string): Promise<PluginDescription> {
    const instance = this.instanceOf(ref, plugin);
    try {
      return await instance.ready;
    } finally {
      this.armIdle(instance);
    }
  }

  /** Хвост лога плагина — им объясняют, почему он не отвечает. */
  log(ref: MapRef, plugin: string): string[] {
    if (this.logs) {
      return this.logs.tail(ref.mapPath, this.logs.fileOf(plugin), 40).map(lineText);
    }
    return this.instances.get(instanceKey(ref.mapPath, plugin))?.log ?? [];
  }

  /** Строка в лог плагина с тем, что известно о вызове. */
  private write(instance: Instance, line: Omit<LogLine, "at" | "file">, call?: Call): void {
    this.logs?.write(instance.ref.mapPath, {
      at: this.clock.now(),
      file: instance.file,
      ...(call === undefined
        ? {}
        : {
            trace: call.trace.trace,
            ...(call.id === undefined ? {} : { call: call.id }),
            ...(call.trace.parent === undefined ? {} : { parent: call.trace.parent }),
            ...(call.trace.object === undefined ? {} : { object: call.trace.object }),
            plugin: instance.plugin,
            method: call.method,
          }),
      ...line,
    });
  }

  /** Вызов кончился: строка конца с длительностью — один раз. */
  private ended(call: Call, status: "success" | "failure" | "stopped", error?: string): void {
    const instance = call.instance;
    if (!instance || call.sentAt === undefined) return;
    const ms = Date.parse(this.clock.now()) - call.sentAt;
    call.sentAt = undefined;
    this.write(
      instance,
      { kind: "call-end", status, ms, ...(error === undefined ? {} : { error }) },
      call,
    );
  }

  /** Погасить все процессы — когда гаснет сама платформа. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.instances.values()].map((instance) => this.stop(instance)));
  }

  private instanceOf(ref: MapRef, plugin: string): Instance {
    const key = instanceKey(ref.mapPath, plugin);
    const existing = this.instances.get(key);
    if (existing && !existing.stopping) return existing;

    const instance: Instance = {
      ref,
      plugin,
      ready: Promise.resolve() as unknown as Promise<PluginDescription>,
      calls: new Set(),
      byId: new Map(),
      requests: new Map(),
      stopping: false,
      stopIdle: noop,
      stopWatch: noop,
      log: [],
      file: this.logs?.fileOf(plugin) ?? plugin,
    };
    instance.ready = this.start(instance);
    // Отказ старта разбирают те, кто ждёт; необработанным он остаться не должен.
    instance.ready.catch(noop);
    this.instances.set(key, instance);
    return instance;
  }

  private async start(instance: Instance): Promise<PluginDescription> {
    const { ref, plugin } = instance;
    try {
      if (!this.processes) throw new Error("этот хост не запускает плагины");
      // Встроенный, которого в карте ещё нет, доставляется сам — и уже доверенным.
      await this.install.restore(ref, plugin);
      if (!(await this.build.entry(plugin))) throw new PluginMissing(plugin, this.install.names());
      if (this.trust && !(await this.trust.allow({ mapPath: ref.mapPath, plugin }))) {
        throw new Error(`плагин ${plugin} не доверен: подтвердите его в редакторе`);
      }
      this.watchCode(instance);
      const built = await this.build.run(ref, plugin);
      if ("errors" in built) throw new Error(`плагин не собрался:\n${built.errors.join("\n")}`);
      if (instance.stopping) throw new Error("плагин остановлен");

      const process = this.processes.start({
        script: built.script,
        cwd: plugin,
        env: this.env.vars(),
      });
      instance.process = process;

      return await new Promise<PluginDescription>((resolve, reject) => {
        process.onLog((text) => {
          for (const line of text.split(/\r?\n/)) {
            if (!line) continue;
            instance.log.push(line);
            this.write(instance, { kind: "stderr", text: line });
          }
          instance.log.splice(0, Math.max(0, instance.log.length - LOG_LINES));
        });
        process.onLine((line) => {
          let parsed: PluginMessage;
          try {
            parsed = JSON.parse(line) as PluginMessage;
          } catch {
            instance.log.push(`не протокол: ${line}`);
            this.write(instance, { kind: "stderr", text: `не протокол: ${line}` });
            return;
          }
          if (parsed.t === "ready") {
            instance.description = parsed.description;
            resolve(parsed.description);
          } else if (parsed.t === "failed") {
            reject(new Error(parsed.message));
            process.kill();
          } else {
            this.receive(instance, parsed);
          }
        });
        process.onExit((code) => {
          const reason = this.exitReason(instance, code);
          reject(new Error(reason));
          this.exited(instance, reason);
        });
        this.send(instance, {
          t: "hello",
          map: { name: ref.name, mapPath: ref.mapPath, basePath: ref.basePath },
          pluginDir: plugin,
          isVscode: this.editor !== undefined,
          ...this.webviewInfo(),
        });
      });
    } catch (error) {
      this.forget(instance);
      throw error;
    }
  }

  /** Адрес моста появляется у редактора позже сервера: поэтому спрашивается, а не хранится. */
  private webviewInfo(): { webview?: { assets: string; bridge: string } } {
    const webview = this.webview?.();
    return webview ? { webview } : {};
  }

  private exitReason(instance: Instance, code: number | null): string {
    // Хвост — из лога плагина: там и stderr, и `ctx.log.error`, по которым видно, где упало.
    const lines = this.logs
      ? this.logs
          .tail(instance.ref.mapPath, instance.file, 40)
          .filter((line) => line.kind === "stderr" || line.kind === "error")
          .slice(-10)
          .map(lineText)
      : instance.log.slice(-10);
    const tail = lines.join("\n");
    return `плагин ${instance.plugin} завершился${code === null ? "" : ` с кодом ${code}`}${tail ? `:\n${tail}` : ""}`;
  }

  /** Процесс ушёл. Остановленный — штатно; иначе это падение, и ждущие узнают почему. */
  private exited(instance: Instance, reason: string): void {
    for (const subscription of instance.requests.values()) subscription.unsubscribe();
    instance.requests.clear();
    if (!instance.stopping) {
      for (const call of instance.calls) {
        this.ended(call, "failure", reason);
        call.sink.error(new Error(reason));
      }
      instance.calls.clear();
      instance.byId.clear();
    }
    this.forget(instance);
  }

  private forget(instance: Instance): void {
    instance.stopIdle();
    instance.stopWatch();
    const key = instanceKey(instance.ref.mapPath, instance.plugin);
    if (this.instances.get(key) === instance) this.instances.delete(key);
  }

  private attach(instance: Instance, call: Call): void {
    instance.calls.add(call);
    instance.stopIdle();
    instance.stopIdle = noop;
    instance.ready.then(
      () => {
        if (!instance.calls.has(call)) return;
        call.id = this.nextId("c");
        call.instance = instance;
        call.sentAt = Date.parse(this.clock.now());
        instance.byId.set(call.id, call);
        this.write(instance, { kind: "call-start" }, call);
        this.send(instance, {
          t: "call",
          id: call.id,
          method: call.method,
          args: call.args,
          trace: call.trace.trace,
          ...(call.trace.object === undefined ? {} : { object: call.trace.object }),
        });
      },
      (error: unknown) => {
        if (!instance.calls.delete(call)) return;
        const failure = error instanceof Error ? error : new Error(message(error));
        // Процесс не поднялся: вызова в нём не было, но строка об отказе — в трейсе зовущего.
        this.write(instance, { kind: "error", text: failure.message }, call);
        call.sink.error(failure);
      },
    );
  }

  private detach(call: Call): void {
    for (const instance of this.instances.values()) {
      if (!instance.calls.delete(call)) continue;
      this.ended(call, "stopped");
      if (call.id) {
        instance.byId.delete(call.id);
        this.send(instance, { t: "cancel", id: call.id });
      }
      this.armIdle(instance);
      return;
    }
  }

  private armIdle(instance: Instance): void {
    if (instance.calls.size > 0 || instance.stopping) return;
    const idle = instance.description?.activation.idle;
    if (idle === false) return;
    instance.stopIdle();
    instance.stopIdle = this.timers.after(idle ?? IDLE_MS, () => {
      if (instance.calls.size === 0) void this.stop(instance);
    });
  }

  private receive(instance: Instance, incoming: PluginMessage): void {
    switch (incoming.t) {
      case "next":
        instance.byId.get(incoming.id)?.sink.next(incoming.value);
        return;
      case "error":
      case "complete": {
        const call = instance.byId.get(incoming.id);
        if (!call) return;
        instance.byId.delete(incoming.id);
        instance.calls.delete(call);
        if (incoming.t === "error") {
          this.ended(call, "failure", incoming.message);
          call.sink.error(new Error(incoming.message));
        } else {
          this.ended(call, "success");
          call.sink.complete();
        }
        this.armIdle(instance);
        return;
      }
      case "request": {
        // Просьба из `ctx` вызова идёт в его трейсе: вложенный вызов знает родителя.
        const from = incoming.call === undefined ? undefined : instance.byId.get(incoming.call);
        const trace = from?.id === undefined ? undefined : { ...from.trace, parent: from.id };
        this.request(instance, incoming.id, incoming, trace);
        return;
      }
      case "log": {
        const from = incoming.call === undefined ? undefined : instance.byId.get(incoming.call);
        this.write(instance, { kind: incoming.kind, text: incoming.text }, from);
        return;
      }
      case "release":
        instance.requests.get(incoming.id)?.unsubscribe();
        instance.requests.delete(incoming.id);
        return;
      default:
        return;
    }
  }

  /** Просьба плагина к платформе — тоже поток: модель карты он видит вместе с её изменениями. */
  private request(instance: Instance, id: string, body: PluginRequest, trace?: TraceRef): void {
    const stream = this.answer(instance, body, trace);
    const subscription = stream.subscribe({
      next: (value) => this.send(instance, { t: "rnext", id, value }),
      error: (error: unknown) => {
        instance.requests.delete(id);
        this.send(instance, { t: "rerror", id, message: message(error) });
      },
      complete: () => {
        instance.requests.delete(id);
        this.send(instance, { t: "rcomplete", id });
      },
    });
    if (!subscription.closed) instance.requests.set(id, subscription);
  }

  private answer(instance: Instance, body: PluginRequest, trace?: TraceRef): Observable<unknown> {
    const { ref } = instance;
    switch (body.op) {
      case "object":
        // Адреса детей — из списка папки, их собственных полей объекту читать незачем.
        return this.map.object$(ref, body.address, "children").pipe(
          mapStream((found) => (found ? toPluginObject(found) : undefined)),
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );
      case "children":
        return this.map.object$(ref, body.address, "children").pipe(
          mapStream((found) => (found?.children ?? []).map(toPluginObject)),
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );
      case "tree":
        // Поддерево по смыслу: плагин сам называет адрес и глубину; `null` — все уровни, JSON
        // `Infinity` не переносит. Без глубины — отказ, а не «всё»: прежняя копия плагина,
        // просившая поддерево без неё, держала бы прочитанной всю карту молча.
        // Неизменившееся модель отдаёт тем же объектом, поэтому тишина узнаётся по ссылке.
        if (body.depth !== null && typeof body.depth !== "number") {
          return throwError(
            () => new Error("ctx.tree(адрес, глубина): глубина обязательна — число или Infinity"),
          );
        }
        return this.map
          .subtree$(ref, body.address, body.depth ?? Infinity)
          .pipe(distinctUntilChanged());
      case "plugin":
        return this.call(ref, body.path, body.method, body.args, trace);
      case "editMap":
      case "undoEdit":
      case "redoEdit": {
        const edits = this.edits;
        if (!edits) return throwError(() => new Error("правки карты у этой платформы нет"));
        const run =
          body.op === "editMap"
            ? () => edits.edit(ref, Array.isArray(body.ops) ? body.ops : [])
            : body.op === "undoEdit"
              ? () => edits.undo(ref, String(body.batch))
              : () => edits.redo(ref, String(body.batch));
        // Одно значение и конец: правка — действие, а не поток. Отписка не отменяет начатое —
        // пачка либо ляжет целиком, либо откатится.
        return new Observable<unknown>((sink) => {
          run().then(
            (value) => {
              sink.next(value);
              sink.complete();
            },
            (error: unknown) => sink.error(error),
          );
        });
      }
      case "vscode":
        return new Observable<unknown>((sink) => {
          const editor = this.editor;
          if (!editor) {
            sink.error(new Error("редактора нет: платформа запущена без VS Code"));
            return;
          }
          this.editorCall(editor, body.method, body.args).then(
            (value) => {
              sink.next(value ?? null);
              sink.complete();
            },
            (error: unknown) => sink.error(error),
          );
        });
    }
  }

  private editorCall(editor: EditorPort, method: string, args: unknown[]): Promise<unknown> {
    const [first, second] = args;
    switch (method) {
      case "openFile":
        return editor.openFile(String(first), (second ?? {}) as { line?: number });
      case "reveal":
        return editor.reveal(String(first));
      case "showMessage":
        return editor.showMessage(String(first), (second ?? "info") as "info");
      case "terminal":
        return editor.terminal(String(first), (second ?? {}) as { name?: string });
      case "executeCommand":
        return editor.executeCommand(String(first), args.slice(1));
      default:
        return Promise.reject(new Error(`у редактора нет ${method}`));
    }
  }

  /** Правка кода плагина — перезапуск: ждущие вызовы переезжают в новый процесс. */
  private watchCode(instance: Instance): void {
    const quiet = debounce(this.timers, this.clock, QUIET_MS, () => {
      void this.restart(instance);
    });
    const stop = this.watcher.watch(
      instance.plugin,
      (path) => {
        if (!path.replaceAll("\\", "/").includes("/node_modules/")) quiet.tick();
      },
      { include: ["**/*"] },
    );
    instance.stopWatch = () => {
      quiet.cancel();
      stop();
    };
  }

  private async restart(instance: Instance): Promise<void> {
    const key = instanceKey(instance.ref.mapPath, instance.plugin);
    if (this.instances.get(key) !== instance) return;
    const calls = [...instance.calls];
    instance.calls.clear();
    instance.byId.clear();
    await this.stop(instance);
    if (calls.length === 0) return;
    const next = this.instanceOf(instance.ref, instance.plugin);
    for (const call of calls) {
      call.id = undefined;
      this.attach(next, call);
    }
  }

  private stop(instance: Instance): Promise<void> {
    if (instance.stopping) return Promise.resolve();
    instance.stopping = true;
    this.forget(instance);
    const process = instance.process;
    if (!process) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const kill = this.timers.after(GRACE_MS, () => {
        process.kill();
        resolve();
      });
      process.onExit(() => {
        kill();
        resolve();
      });
      for (const call of instance.calls) {
        if (call.id) this.send(instance, { t: "cancel", id: call.id });
      }
      this.send(instance, { t: "shutdown" });
    });
  }

  private send(instance: Instance, outgoing: PlatformMessage): void {
    instance.process?.send(`${JSON.stringify(outgoing)}\n`);
  }
}

/** Строка лога текстом — для хвоста причины падения. */
function lineText(line: LogLine): string {
  return line.text ?? line.error ?? line.kind;
}
