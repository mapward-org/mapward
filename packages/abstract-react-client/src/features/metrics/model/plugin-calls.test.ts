import { Observable, type Subscriber } from "rxjs";
import { expect, test } from "vitest";
import { MutationStore, QueryStore, StreamStore } from "./plugin-calls.ts";
import type { PluginStream } from "../pure-model/plugin-stream.ts";
import type { Watchable } from "../../../lib/store/reactive.ts";

/** Сколько раз стор сказал «во мне поменялось» после подписки — так его слышит вид. */
function changes(store: Watchable) {
  let count = -1;
  store.changed$.subscribe(() => {
    count += 1;
  });
  return () => count;
}

/** Поток по кнопке: что и когда отдать, решает тест. */
function manual<T>() {
  let sink: Subscriber<T> | undefined;
  let subscribed = 0;
  let unsubscribed = 0;
  const stream: PluginStream<T> = new Observable<T>((subscriber) => {
    sink = subscriber;
    subscribed += 1;
    return () => {
      unsubscribed += 1;
    };
  });
  return {
    stream,
    next: (value: T) => sink?.next(value),
    error: (error: unknown) => sink?.error(error),
    complete: () => sink?.complete(),
    counts: () => ({ subscribed, unsubscribed }),
  };
}

test("запрос: подписка на монтировании, ошибка не стирает прошлое значение, уход — отписка", () => {
  const source = manual<number>();
  const query = new QueryStore(() => source.stream);
  const heard = changes(query);
  expect(query.status).toBe("loading");

  query.mount();
  source.next(1);
  expect([query.status, query.data]).toEqual(["success", 1]);
  expect(heard()).toBeGreaterThan(0);

  source.error(new Error("упал"));
  expect([query.status, query.data, query.error]).toEqual(["error", 1, "упал"]);

  query.unmount();
  expect(source.counts()).toEqual({ subscribed: 1, unsubscribed: 1 });
});

test("поток: каждое значение и конец", () => {
  const source = manual<string>();
  const stream = new StreamStore(() => source.stream);
  const heard = changes(stream);
  stream.mount();
  source.next("a");
  const afterFirst = heard();
  source.next("b");
  expect([stream.status, stream.last]).toEqual(["open", "b"]);
  expect(heard()).toBeGreaterThan(afterFirst);
  source.complete();
  expect(stream.status).toBe("done");
});

test("изменение: по вызову, новый запуск отменяет идущий", () => {
  const source = manual<string>();
  const mutation = new MutationStore((_args: { id: string }) => source.stream);
  expect(mutation.status).toBe("idle");

  const run = mutation.run;
  run({ id: "1" });
  run({ id: "2" });
  expect(source.counts()).toEqual({ subscribed: 2, unsubscribed: 1 });

  source.next("готово");
  source.complete();
  expect([mutation.status, mutation.data]).toEqual(["success", "готово"]);
});
