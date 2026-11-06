import { distinctUntilChanged, map, merge, startWith } from "rxjs";
import { PLATFORM_LOG, type LogFilter, type LogLine, type Run } from "@mapward/core";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";
import { lineFields, logFiles, logFilter, type LogScope } from "../pure-model/logs.ts";

const NONE: LogLine[] = [];

/** Строки логов по фильтру — ресурс моста: значения нет, пока сервер не ответил. */
export type LogFeed = Watchable & { readonly value: LogLine[] | undefined };

/** Откуда строки: открытый объект, его смена и ресурс строк по фильтру. */
export type LogsSource = {
  readonly object: string;
  readonly moves: Watchable;
  logs(filter: LogFilter): LogFeed;
};

/** Состояние вида: помнится у человека, в историю не идёт. */
export type Slot<T> = Watchable & { readonly value: T; set(value: T): void };

/** Экран прогонов: какой прогон открыт справа. */
export type OpenRun = Watchable & { readonly open: Run | undefined };

const sameFeeds = (a: LogFeed[], b: LogFeed[]) =>
  a.length === b.length && a.every((feed, index) => feed === b[index]);

/**
 * Лог на экране прогонов. Открыт прогон — строки его трейса, живьём: окно растёт по ходу.
 * Не открыт — основной вид, лог объекта; фильтр по плагину выбирает файл из тех, что у объекта
 * встречаются. «Вся карта» — вид для отладки, без объекта; фильтр по плагину там тот же.
 */
export class LogsPanelStore extends Reactive {
  constructor(
    private readonly source: LogsSource,
    private readonly runs: OpenRun,
    private readonly scopeSlot: Slot<LogScope>,
    /** Имя файла плагина; пустое — все файлы. */
    private readonly fileSlot: Slot<string>,
    /** Трейс, выбранный кликом по номеру в строке; пустой — не выбран. */
    private readonly traceSlot: Slot<string>,
  ) {
    super();
    this.depend(scopeSlot, fileSlot, traceSlot);
    // Смотрим на ресурсы текущего фильтра: сменился объект, прогон или фильтр — сменились и они.
    this.dependOn(
      merge(
        source.moves.changed$,
        runs.changed$,
        scopeSlot.changed$,
        fileSlot.changed$,
        traceSlot.changed$,
      ).pipe(
        startWith(undefined),
        map(() => this.feeds()),
        distinctUntilChanged(sameFeeds),
      ),
    );
  }

  /**
   * Трейс на экране: открытого прогона — номер прогона и есть номер его трейса, — иначе
   * выбранный кликом. Трейс перекрывает объект и плагин: он сквозной и сам по себе один.
   */
  get trace(): string | undefined {
    return this.runs.open?.id ?? this.picked;
  }

  /** Трейс, выбранный кликом, — пока прогон не открыт. */
  get picked(): string | undefined {
    return this.traceSlot.value === "" ? undefined : this.traceSlot.value;
  }

  pickTrace(trace: string): void {
    this.traceSlot.set(trace);
  }

  clearTrace(): void {
    this.traceSlot.set("");
  }

  /** Клик по номеру трейса в строке: прогон закрывается, лог показывает весь трейс. */
  showTrace(trace: string, select: (run: string | undefined) => void): void {
    this.pickTrace(trace);
    select(undefined);
  }

  /** Пункт «лог объекта» в списке: и прогон, и выбранный трейс закрываются. */
  openLog(select: (run: string | undefined) => void): void {
    this.clearTrace();
    select(undefined);
  }

  get scope(): LogScope {
    return this.scopeSlot.value;
  }

  setScope(scope: LogScope): void {
    this.scopeSlot.set(scope);
  }

  get file(): string {
    return this.fileSlot.value;
  }

  setFile(file: string): void {
    this.fileSlot.set(file);
  }

  private filter(trace: string | undefined, file: string): LogFilter {
    return logFilter({ trace, scope: this.scope, object: this.source.object, file });
  }

  /** Строки на экране; второй ресурс — из чего выбирать плагин: тот же вид без фильтра файла. */
  private feeds(): LogFeed[] {
    const shown = this.source.logs(this.filter(this.trace, this.file));
    return this.trace === undefined
      ? [shown, this.source.logs(this.filter(undefined, ""))]
      : [shown];
  }

  get lines(): LogLine[] {
    return this.source.logs(this.filter(this.trace, this.file)).value ?? NONE;
  }

  get empty(): boolean {
    return this.lines.length === 0;
  }

  /** Файл лога самой платформы — у фильтра для него отдельная кнопка. */
  readonly platform = PLATFORM_LOG;

  /** Файлы плагинов, чьи строки есть в виде, — для фильтра по плагину. */
  get files(): string[] {
    return logFiles(this.source.logs(this.filter(undefined, "")).value ?? NONE, this.file);
  }

  /** Поля под строкой: объект — только когда строки не одного объекта. */
  fields(line: LogLine): [string, string][] {
    return lineFields(line, this.showObject);
  }

  /** Объект у строки нужен, когда строки не одного объекта: в трейсе и на всей карте. */
  get showObject(): boolean {
    return this.trace !== undefined || this.scope === "map";
  }

  get title(): string {
    if (this.runs.open !== undefined) return "Лог прогона";
    if (this.picked !== undefined) return "Лог трейса";
    return this.scope === "object" ? "Лог объекта" : "Все логи карты";
  }
}
