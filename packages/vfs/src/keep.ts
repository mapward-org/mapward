import { Observable } from "rxjs";
import type { TimersPort } from "./ports.ts";

/**
 * Срок, на который `LiveFiles` держат файл после ухода последнего читателя, — таймером среды:
 * своих таймеров у пакета нет. Серия вопросов подряд тогда не читает диск на каждый.
 */
export const keepFor =
  (timers: TimersPort, ms: number): (() => Observable<unknown>) =>
  () =>
    new Observable<unknown>((subscriber) =>
      timers.after(ms, () => {
        subscriber.next(undefined);
        subscriber.complete();
      }),
    );
