import type { MapEditOp, MapEditResult } from "@mapward/core";
import type { PluginSources } from "@mapward/plugins";
import type { MapRef } from "../../kernel/map-ref.ts";

/** Правка карты платформой — ей ставится кусок карты, одной пачкой с отменой. */
export type MarketMapEdits = (ref: MapRef, ops: MapEditOp[]) => Promise<MapEditResult>;

/** Объект карты по адресу: где лежит его папка и какие папки детей у него уже есть. */
export type MarketPlace = (
  ref: MapRef,
  address: string,
) => Promise<{ path: string; children: string[] } | undefined>;

/** Ответ установки плагина — тот же, что у встроенного. */
export type InstallResult =
  | { ok: true; plugin: string; files: string[]; dependencies?: string[] }
  | { ok: false; error: string };

/** Установка плагина — та же, что у встроенного; из реестра — без доверия. */
export type MarketInstaller = {
  names(): string[];
  run(ref: MapRef, name: string, folder?: string): Promise<InstallResult>;
  copy(
    ref: MapRef,
    params: { name: string; sources: PluginSources; folder?: string; trusted: boolean },
  ): Promise<InstallResult>;
};
