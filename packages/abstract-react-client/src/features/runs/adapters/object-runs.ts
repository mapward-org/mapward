import { distinctUntilChanged, map, startWith } from "rxjs";
import type { AppBridge, BridgeClient, LogFilter, LogLine, Run } from "@mapward/core";
import { Feed } from "../../../lib/store/feed.ts";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";
import { filterKey } from "../pure-model/logs.ts";
import { lastRun, runningCount } from "../pure-model/runs.ts";

const NONE: Run[] = [];

/**
 * Прогоны открытого объекта — решение 0038: держит сервер, клиент подписывается. Идущий прогон
 * меняется у сервера на каждом шаге, и подписка приносит его заново — экран обновляется живьём.
 * Ими питаются экран прогонов, числа у кнопок экшонов и красная точка метрики: подписка одна на
 * вид. Открыли другой объект — читается другой ресурс, прежний отписывается сам.
 *
 * Своего хранилища у прогонов нет — сервер собирает их из строк логов; сами строки по фильтру
 * отдаёт `logs`: ими экран прогонов показывает лог объекта и лог выбранного прогона.
 */
export class ObjectRuns extends Reactive {
  private readonly feeds = new Map<string, Feed<Run[]>>();
  private readonly logFeeds = new Map<string, Feed<LogLine[]>>();

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly mapPath: string,
    private readonly address: () => string,
    /** То, вместе с чем меняется `address`: экран, перешедший на другой объект. */
    readonly moves: Watchable,
  ) {
    super();
    // Стор смотрит на ресурс текущего объекта; сменился объект — сменился и ресурс.
    this.dependOn(
      moves.changed$.pipe(
        startWith(undefined),
        map(() => this.feed(this.address())),
        distinctUntilChanged(),
        map((feed) => [feed]),
      ),
    );
  }

  private feed(address: string): Feed<Run[]> {
    let feed = this.feeds.get(address);
    if (!feed) {
      feed = new Feed(this.bridge.watchRuns({ mapPath: this.mapPath, address }));
      this.feeds.set(address, feed);
    }
    return feed;
  }

  /** Адрес открытого объекта: по нему фильтруется лог объекта. */
  get object(): string {
    return this.address();
  }

  get list(): Run[] {
    return this.feed(this.address()).value ?? NONE;
  }

  /**
   * Строки логов по фильтру — ресурс: подписка, пока на него смотрят. Окно приходит заново на
   * каждую пачку записи, поэтому лог идущего прогона растёт сам. Одинаковый фильтр — один ресурс.
   */
  logs(filter: LogFilter): Feed<LogLine[]> {
    const key = filterKey(filter);
    let feed = this.logFeeds.get(key);
    if (!feed) {
      feed = new Feed(this.bridge.watchLogs({ mapPath: this.mapPath, filter }));
      this.logFeeds.set(key, feed);
    }
    return feed;
  }

  /** Сколько прогонов цели идёт сейчас: прогоны одного экшона бывают параллельными. */
  running(target: string): number {
    return runningCount(this.list, target);
  }

  /** Последний прогон экшона или метрики: на него ведёт красная точка метрики. */
  last(target: string): Run | undefined {
    return lastRun(this.list, target);
  }

  stop(id: string): void {
    void this.bridge.stopRun({ mapPath: this.mapPath, id });
  }
}
