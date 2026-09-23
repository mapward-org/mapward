import { BehaviorSubject, type Observable } from "rxjs";
import { stageFinished, turnTaken, type Turn, type TurnKey } from "../domain/turns.ts";

/**
 * Список «ждут ответа» живёт в памяти сервера: он нужен, пока человек работает, и не должен
 * копиться между перезапусками (решение 0034). Один на сервер — общий для всех карт окна.
 *
 * Подписчик сразу получает текущий список, потом каждое изменение — как подписка на карту.
 */
export function createTurnStore() {
  const turns = new BehaviorSubject<Turn[]>([]);

  const set = (next: Turn[]) => {
    if (next !== turns.value) turns.next(next);
  };

  return {
    watch: (): Observable<Turn[]> => turns.asObservable(),
    finished: (turn: Turn) => set(stageFinished(turns.value, turn)),
    taken: (key: TurnKey) => set(turnTaken(turns.value, key)),
  };
}
