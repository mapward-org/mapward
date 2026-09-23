/** Сдвиг и масштаб холста — как их помнит холст. */
export type Viewport = { x: number; y: number; zoom: number };

type Positions = Record<string, { x: number; y: number }>;
type Slot<T> = { value: T; set(value: T): void };

/** Где лежат узлы — у карты, для всех (`map-state.json`). */
export type NodePlaces = { positions: Positions; move(positions: Positions): void };

/**
 * Карта детей одной метрики — решение 0003. Положение узлов принадлежит карте, а масштаб и
 * сдвиг холста — тому, кто смотрит: они лежат в состоянии вида, под адресом метрики.
 */
export class ChildrenMapStore {
  private readonly viewport: Slot<Viewport | undefined>;

  constructor(
    private readonly places: NodePlaces,
    views: { slot<T>(key: string, initial: T): Slot<T> },
    address: string,
  ) {
    this.viewport = views.slot<Viewport | undefined>(`viewport:${address}`, undefined);
  }

  get positions(): Positions {
    return this.places.positions;
  }

  get view(): Viewport | undefined {
    return this.viewport.value;
  }

  move(positions: Positions): void {
    this.places.move(positions);
  }

  pan(viewport: Viewport): void {
    this.viewport.set(viewport);
  }
}
