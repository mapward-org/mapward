import { Observable, type Subscriber } from "rxjs";
import { expect, test } from "vitest";
import type { PluginStream } from "@mapward/component";
import type { EditResult } from "../model/ops.ts";
import { settle } from "./settle.ts";

/** Поток по сценарию: что отдать при подписке и снята ли подписка. */
function stream(run: (observer: Subscriber<EditResult>) => void) {
  const state = { unsubscribed: false };
  const call: PluginStream<EditResult> = new Observable<EditResult>((observer) => {
    run(observer);
    return () => {
      state.unsubscribed = true;
    };
  });
  return { call, state };
}

test("the first value of a stream is the answer, and the call is let go", async () => {
  const { call, state } = stream((observer) => {
    observer.next({ ok: true, id: "1", touched: [] });
    observer.next({ ok: false, error: "второе не нужно" });
  });
  expect(await settle(call)).toEqual({ ok: true, id: "1", touched: [] });
  expect(state.unsubscribed).toBe(true);
});

test("a failed or empty stream is a refusal, not silence", async () => {
  const failed = stream((observer) => observer.error(new Error("плагин упал")));
  expect(await settle(failed.call)).toEqual({ ok: false, error: "плагин упал" });
  const empty = stream((observer) => observer.complete());
  expect((await settle(empty.call)).ok).toBe(false);
});
