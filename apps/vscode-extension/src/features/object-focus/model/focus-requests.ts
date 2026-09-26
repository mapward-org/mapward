import { Observable } from "rxjs";

export type FocusRequest = { mapPath: string; address: string };

/**
 * Просьба сайдбару перейти к объекту. Сайдбара бывает ещё нет — не открывали с перезагрузки или
 * он закрыт, — и тогда просьба ждёт подписчика. Ждёт одна, последняя: два нажатия до того, как
 * сайдбар поднялся, ведут туда, куда нажали вторым.
 *
 * Отдаётся один раз. Иначе сайдбар, пересозданный через час, прыгнул бы к объекту, о котором
 * давно забыли.
 */
export class FocusRequests {
  private pending: FocusRequest | undefined;
  private readonly listeners = new Set<(request: FocusRequest) => void>();

  request(next: FocusRequest): void {
    if (this.listeners.size === 0) {
      this.pending = next;
      return;
    }
    for (const listener of this.listeners) listener(next);
  }

  watch(): Observable<FocusRequest> {
    return new Observable<FocusRequest>((subscriber) => {
      const listener = (request: FocusRequest) => subscriber.next(request);
      this.listeners.add(listener);
      const waiting = this.pending;
      this.pending = undefined;
      if (waiting) listener(waiting);
      return () => this.listeners.delete(listener);
    });
  }
}
