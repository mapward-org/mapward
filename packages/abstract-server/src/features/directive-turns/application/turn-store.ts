import { BehaviorSubject, type Observable } from "rxjs";
import { stageFinished, turnTaken, type Turn, type TurnKey } from "../domain/turns.ts";

/**
 * Список «ждут ответа» живёт в памяти сервера: он нужен, пока человек работает, и не должен
 * копиться между перезапусками (решение 0034). Один на сервер — общий для всех карт окна.
 *
 * Подписчик сразу получает текущий список, потом каждое изменение — как подписка на карту.
 */
export class TurnStore {
  private readonly turns = new BehaviorSubject<Turn[]>([]);

  watch(): Observable<Turn[]> {
    return this.turns.asObservable();
  }

  finished(turn: Turn): void {
    this.set(stageFinished(this.turns.value, turn));
  }

  taken(key: TurnKey): void {
    this.set(turnTaken(this.turns.value, key));
  }

  private set(next: Turn[]): void {
    if (next !== this.turns.value) this.turns.next(next);
  }
}
