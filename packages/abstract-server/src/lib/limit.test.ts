import { expect, test } from "vitest";
import { createLimit } from "./limit.ts";

/** Лимит параллельности из решения 0013: по умолчанию его нет, с ним — очередь. */
test("without a limit everything runs at once", async () => {
  const limited = createLimit(undefined);
  let running = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 5 }, () =>
      limited(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await Promise.resolve();
        running -= 1;
      }),
    ),
  );

  expect(peak).toBe(5);
});

test("a limit holds the rest in a queue", async () => {
  const limited = createLimit(2);
  let running = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 6 }, () =>
      limited(async () => {
        running += 1;
        peak = Math.max(peak, running);
        // Пакет не знает про таймеры среды — для паузы хватает микротаска.
        await Promise.resolve();
        await Promise.resolve();
        running -= 1;
      }),
    ),
  );

  expect(peak).toBe(2);
});
