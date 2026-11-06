import type { LogLine, MapEditOp, MapEditResult, MapObject } from "@mapward/core";
import type { Observable } from "rxjs";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Что плагинам нужно от карты: объект по адресу потоком — `ctx.object` и `ctx.children`, — и
 * поддерево от адреса для `ctx.tree`. Каждый читает своё, а не всю карту.
 */
export type PluginsMapSource = {
  object$(
    ref: MapRef,
    address: string,
    shape?: "own" | "children",
  ): Observable<MapObject | undefined>;
  subtree$(ref: MapRef, address: string, depth: number): Observable<MapObject | undefined>;
};

/**
 * Правка карты для плагинов — `ctx.editMap`, `ctx.undoEdit`, `ctx.redoEdit`: тот же базовый
 * набор платформы, что у интерфейса и агента, — адреса при переносе переписывает она.
 */
export type PluginsMapEdits = {
  edit(ref: MapRef, ops: MapEditOp[]): Promise<MapEditResult>;
  undo(ref: MapRef, id: string): Promise<MapEditResult>;
  redo(ref: MapRef, id: string): Promise<MapEditResult>;
};

/**
 * Логи карты для хоста: строки вызовов, `ctx.log` и stderr — в файл плагина, хвост — из памяти,
 * им объясняется падение процесса.
 */
export type PluginsLogs = {
  fileOf(plugin: string): string;
  write(mapPath: string, line: LogLine): void;
  tail(mapPath: string, file: string, count: number): LogLine[];
};
