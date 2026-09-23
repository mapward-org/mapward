import { isHistory, type History } from "../pure-model/navigation.ts";

type Slot = { value: unknown; ready: boolean; set(value: unknown): void };

/**
 * История карты в сайдбаре — в состоянии вида, по карте своя (решение 0036). Пока хранилище не
 * ответило, её нет: переход, сделанный раньше ответа, затёрла бы пришедшая следом история.
 */
export class SavedHistory {
  private readonly slot: Slot;

  constructor(views: { slot<T>(key: string, initial: T): Slot }, mapPath: string) {
    this.slot = views.slot<unknown>(`history:${mapPath}`, undefined);
  }

  get ready(): boolean {
    return this.slot.ready;
  }

  get history(): History | undefined {
    return isHistory(this.slot.value) ? this.slot.value : undefined;
  }

  save(history: History): void {
    this.slot.set(history);
  }
}
