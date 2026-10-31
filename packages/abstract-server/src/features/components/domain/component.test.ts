import { expect, test } from "vitest";
import { candidates } from "./component.ts";

test("кандидаты в классы: arbitrary-значения и варианты целиком", () => {
  const found = candidates('<div className="p-2 hover:underline text-[var(--mw-foreground)]">');
  expect(found).toEqual(
    expect.arrayContaining(["p-2", "hover:underline", "text-[var(--mw-foreground)]"]),
  );
});
