import * as T from "typebox";
import type * as Core from "@mapward/core";

/**
 * Схемы конфигов карты — ими сервер проверяет файлы, прежде чем положить их в модель. Что
 * значит каждое поле, сказано у типов в `@mapward/core` (`model/configs.ts`): по мосту и в
 * плагин едут типы, а схемы нужны только тому, кто читает диск. Что схема и тип не разошлись,
 * сторожит `schema.test.ts`.
 */

export const MetricGroup = T.Object({
  key: T.String(),
  label: T.Optional(T.String()),
  description: T.Optional(T.String()),
  metrics: T.Array(T.String()),
  layout: T.Optional(T.String()),
  defaultPreview: T.Optional(T.Boolean()),
});

export const MetricGroups = T.Object({
  mode: T.Optional(T.Union([T.Literal("merge"), T.Literal("replace")])),
  groups: T.Array(MetricGroup),
});

export const ObjectIndex = T.Object({
  name: T.Optional(T.String()),
  props: T.Optional(T.Record(T.String(), T.Unknown())),
  extends: T.Optional(T.String()),
  prompt: T.Optional(T.String()),
  "directives-workflow": T.Optional(
    T.Object({
      mode: T.Optional(T.Union([T.Literal("merge"), T.Literal("replace")])),
      prompt: T.Optional(T.String()),
    }),
  ),
  "metric-groups": T.Optional(MetricGroups),
});

export const MetricConfig = T.Object({
  label: T.Optional(T.String()),
  extends: T.Optional(T.String()),
  component: T.Optional(T.String()),
  params: T.Optional(T.Record(T.String(), T.Unknown())),
  agent: T.Optional(
    T.Object({
      plugin: T.String(),
      method: T.String(),
      params: T.Optional(T.Unknown()),
    }),
  ),
});

export const ActionInput = T.Object({
  type: T.Optional(
    T.Union([T.Literal("string"), T.Literal("boolean"), T.Literal("number"), T.Literal("choice")]),
  ),
  description: T.Optional(T.String()),
  required: T.Optional(T.Boolean()),
  default: T.Optional(T.Union([T.String(), T.Number(), T.Boolean()])),
  options: T.Optional(T.Array(T.String())),
  multiline: T.Optional(T.Boolean()),
});

export const ActionConfig = T.Object({
  label: T.Optional(T.String()),
  description: T.Optional(T.String()),
  extends: T.Optional(T.String()),
  confirm: T.Optional(T.Union([T.Boolean(), T.String()])),
  plugin: T.Optional(T.String()),
  method: T.Optional(T.String()),
  params: T.Optional(T.Record(T.String(), T.Unknown())),
  component: T.Optional(T.String()),
  inputs: T.Optional(T.Record(T.String(), ActionInput)),
});

export type ActionInput = Core.ActionInput;
export type ActionConfig = Core.ActionConfig;
export type MetricGroup = Core.MetricGroup;
export type MetricGroups = Core.MetricGroups;
export type ObjectIndex = Core.ObjectIndex;
export type MetricConfig = Core.MetricConfig;
