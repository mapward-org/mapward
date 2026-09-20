import { expect, test } from "vitest";
import type { ClockPort, TimersPort } from "../ports/index.ts";
import { debounce } from "./debounce.ts";

/** Таймеры и часы под рукой: пакет не знает ни про те, ни про другие — решение 0014. */
function fake() {
  let now = 0;
  const queue: { at: number; run: () => void }[] = [];

  const timers: TimersPort = {
    every: () => () => undefined,
    after: (ms, run) => {
      const entry = { at: now + ms, run };
      queue.push(entry);
      return () => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
      };
    },
  };

  const clock: ClockPort = { now: () => new Date(now).toISOString() };

  /** Перевести время и выполнить всё, что к этому моменту истекло. */
  const advance = (ms: number) => {
    now += ms;
    const due = queue.filter((entry) => entry.at <= now);
    for (const entry of due) {
      queue.splice(queue.indexOf(entry), 1);
      entry.run();
    }
  };

  return { timers, clock, advance };
}

test("серия тиков даёт один вызов, и только после тишины", () => {
  const { timers, clock, advance } = fake();
  let calls = 0;
  const beat = debounce(timers, clock, 300, () => (calls += 1));

  beat.tick();
  advance(100);
  beat.tick();
  advance(100);
  beat.tick();

  // Триста миллисекунд от первого тика уже прошли, но тишины ещё не было.
  advance(100);
  expect(calls).toBe(0);

  advance(200);
  expect(calls).toBe(1);
});

test("новая серия после срабатывания считается заново", () => {
  const { timers, clock, advance } = fake();
  let calls = 0;
  const beat = debounce(timers, clock, 300, () => (calls += 1));

  beat.tick();
  advance(300);
  expect(calls).toBe(1);

  beat.tick();
  advance(300);
  expect(calls).toBe(2);
});

test("снятое отложенное не срабатывает", () => {
  const { timers, clock, advance } = fake();
  let calls = 0;
  const beat = debounce(timers, clock, 300, () => (calls += 1));

  beat.tick();
  beat.cancel();
  advance(1000);

  expect(calls).toBe(0);
});
