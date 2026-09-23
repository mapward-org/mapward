import { action, makeObservable, observableRef } from "mobx";
import { once, type Resource } from "@mapward/core";
import type { AppBridge, BridgeClient } from "@mapward/core";

export type Positions = Record<string, { x: number; y: number }>;
type Saved = { positions?: Positions };

const EMPTY: Positions = {};

/**
 * Положение узлов принадлежит карте, а не тому, кто на неё смотрит: все должны открыть одну и
 * ту же картинку. Поэтому оно лежит в `map-state.json`, в отличие от масштаба и сдвига.
 */
export class MapState {
  private written: Saved | undefined;
  private readonly stored: Resource<unknown>;

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly mapPath: string,
  ) {
    this.stored = once(() => bridge.getMapState({ mapPath }));
    makeObservable<MapState, "written">(this, { written: observableRef, move: action });
  }

  private get saved(): Saved {
    return this.written ?? ((this.stored.value ?? {}) as Saved);
  }

  get positions(): Positions {
    return this.saved.positions ?? EMPTY;
  }

  move(positions: Positions): void {
    const next = { ...this.saved, positions: { ...this.saved.positions, ...positions } };
    this.written = next;
    void this.bridge.setMapState({ mapPath: this.mapPath, value: next });
  }
}
