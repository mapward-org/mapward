import { BehaviorSubject, type Observable } from "rxjs";
import {
  removed,
  turnTaken,
  upsert,
  type ActionTurn,
  type DirectiveTurn,
  type Turn,
  type TurnKey,
} from "../domain/turns.ts";

type Placed<T> = Omit<T, "kind" | "state">;

/**
 * Лента активности живёт в памяти сервера: она нужна, пока человек работает, и не должна
 * копиться между перезапусками (решение 0034). Одна на сервер — общая для всех карт окна.
 * Идущий прогон после перезапуска всё равно возвращается остановленным, так что терять нечего.
 *
 * Подписчик сразу получает текущий список, потом каждое изменение — как подписка на карту.
 */
export class TurnStore {
  private readonly turns = new BehaviorSubject<Turn[]>([]);

  watch(): Observable<Turn[]> {
    return this.turns.asObservable();
  }

  /** Этап взяли в работу: директива идёт, и прежний «ждёт ответа» у неё снимается. */
  started(turn: Placed<DirectiveTurn>): void {
    this.set(upsert(this.turns.value, { ...turn, kind: "directive", state: "running" }));
  }

  /** Этап кончился — ход у человека. */
  finished(turn: Placed<DirectiveTurn>): void {
    this.set(upsert(this.turns.value, { ...turn, kind: "directive", state: "waiting" }));
  }

  /**
   * Прогон запущен. Экшон — откуда угодно: кнопкой, строкой дисплея, агентом, терминалом;
   * ручная метрика — когда её запустил человек или агент, что сюда пускать, решают метрики.
   */
  actionStarted(turn: Placed<ActionTurn>, kind: ActionTurn["kind"] = "action"): void {
    this.set(upsert(this.turns.value, { ...turn, kind, state: "running" }));
  }

  /**
   * Экшон кончился. Успешный и остановленный уходят: первый смотреть незачем, второй остановил
   * сам человек. Упавший остаётся, пока его не откроют, — иначе про падение фонового прогона
   * не узнать.
   */
  actionEnded(
    turn: Placed<ActionTurn>,
    failed: boolean,
    kind: ActionTurn["kind"] = "action",
  ): void {
    this.set(
      failed
        ? upsert(this.turns.value, { ...turn, kind, state: "failed" })
        : removed(this.turns.value, turn),
    );
  }

  /** Человек открыл пункт. Идущее не убирается — оно уйдёт само, когда кончится. */
  taken(key: TurnKey): void {
    this.set(turnTaken(this.turns.value, key));
  }

  private set(next: Turn[]): void {
    if (next !== this.turns.value) this.turns.next(next);
  }
}
