import { BehaviorSubject, from, of } from "rxjs";
import { expect, test } from "vitest";
import { every, follow, PENDING, settle, type Maybe } from "./stream.ts";

const one = (value: Maybe<number>) => of(value);

test("every ждёт все части, follow не смешивает новое со старым", () => {
  const seen: unknown[] = [];
  every([one(1), one(PENDING)]).subscribe((value) => seen.push(value));
  every([one(1), one(2)]).subscribe((value) => seen.push(value));
  from<Maybe<number>[]>([PENDING, 3])
    .pipe(follow((value) => of(value * 2)))
    .subscribe((value) => seen.push(value));
  expect(seen).toEqual([PENDING, [1, 2], PENDING, PENDING, 6]);
});

test("settle отдаёт одно готовое значение на такт", async () => {
  const source = new BehaviorSubject<Maybe<number>>(PENDING);
  const seen: number[] = [];
  source.pipe(settle()).subscribe((value) => seen.push(value));
  source.next(1);
  source.next(2);
  await Promise.resolve();
  await Promise.resolve();
  expect(seen).toEqual([2]);
});
