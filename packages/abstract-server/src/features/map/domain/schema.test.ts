import type * as Core from "@mapward/core";
import type { Static } from "typebox";
import { expectTypeOf, test } from "vitest";
import * as Schema from "./schema.ts";

/**
 * Схема проверяет файл, тип едет по мосту: поле, добавленное в одно и забытое в другом, сервер
 * молча выбросил бы при чтении или клиент не увидел бы в типах. Проверка — компилятором, на
 * `typecheck`.
 */
test("схемы файлов и типы core описывают одно", () => {
  expectTypeOf<Static<typeof Schema.MetricGroup>>().toEqualTypeOf<Core.MetricGroup>();
  expectTypeOf<Static<typeof Schema.MetricGroups>>().toEqualTypeOf<Core.MetricGroups>();
  expectTypeOf<Static<typeof Schema.ObjectIndex>>().toEqualTypeOf<Core.ObjectIndex>();
  expectTypeOf<Static<typeof Schema.ActionInput>>().toEqualTypeOf<Core.ActionInput>();
  expectTypeOf<Static<typeof Schema.ActionConfig>>().toEqualTypeOf<Core.ActionConfig>();
  // Лишние поля метрики схема пропускает, а тип держит их индексом: тождества тут не будет,
  // поэтому — в обе стороны.
  type Metric = Static<typeof Schema.MetricConfig> & { [field: string]: unknown };
  expectTypeOf<Metric>().toExtend<Core.MetricConfig>();
  expectTypeOf<Core.MetricConfig>().toExtend<Metric>();
});
