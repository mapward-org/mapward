import type { CheckReport, ComponentBuild, MapObject } from "@mapward/core";
import type { PluginDescription } from "@mapward/plugin";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Что правке нужно от модели карты: вся карта по смыслу — перенос переписывает адреса где угодно
 * — и перечитать то, что правка тронула мимо `writer` (перенос и удаление папок). Следующая
 * операция пачки считается по модели, где уже есть своё.
 */
export type MapEditsSource = {
  current(ref: MapRef): Promise<MapObject>;
  refresh(paths: string[]): Promise<void>;
};

/**
 * Схемы своих файлов карты — их держит фича карты, которая ими же читает диск: `set` пишет только
 * то, что модель потом прочтёт.
 */
export type MapSchemas = { object: unknown; metric: unknown; action: unknown };

/**
 * Плагины для проверки записи и для `check`: самоописание (методы, их схемы, шаблоны метрик),
 * пробный запрос, проверка папки плагина и установка его зависимостей.
 */
export type MapEditsPlugins = {
  describe(ref: MapRef, plugin: string): Promise<PluginDescription>;
  first(
    ref: MapRef,
    plugin: string,
    method: string,
    args: unknown,
    timeout: number,
  ): Promise<unknown>;
  check(ref: MapRef, plugin: string, timeout: number): Promise<CheckReport>;
  /** Зависимости из `package.json` папки; ответ — их имена. Отказ — понятной строкой. */
  installDeps(ref: MapRef, plugin: string): Promise<{ dependencies: string[] } | { error: string }>;
};

/** Разовые сборки компонентов — те же, что рисуют карту. */
export type MapEditsBuilds = {
  metric(ref: MapRef, address: string): Promise<ComponentBuild>;
  layout(ref: MapRef, address: string, group: string): Promise<ComponentBuild>;
  actionForm(ref: MapRef, action: string): Promise<ComponentBuild>;
};
