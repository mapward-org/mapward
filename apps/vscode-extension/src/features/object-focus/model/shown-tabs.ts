import type { ShownTab } from "../pure-model/focus-target.ts";

/**
 * Что показывает каждая открытая вкладка объекта. Живёт в памяти: после перезагрузки окна
 * редактор возвращает вкладки сам, и каждая попадает сюда в момент возвращения — с объектом из
 * истории, которую она о себе сохранила, не дожидаясь, пока её откроют.
 *
 * Активность — счётчик, а не часы: нужен только порядок, а два события в одну миллисекунду
 * часы бы не различили.
 */
export class ShownTabs<T> {
  private readonly tabs = new Map<T, ShownTab<T>>();
  private clock = 0;

  /** Вкладка открылась, вернулась после перезагрузки или ушла переходом на другой объект. */
  show(tab: T, place: { mapPath: string; address: string }): void {
    const known = this.tabs.get(tab);
    this.tabs.set(tab, {
      tab,
      mapPath: place.mapPath,
      address: place.address,
      activeAt: known?.activeAt ?? ++this.clock,
    });
  }

  activate(tab: T): void {
    const known = this.tabs.get(tab);
    if (known) known.activeAt = ++this.clock;
  }

  close(tab: T): void {
    this.tabs.delete(tab);
  }

  list(): Iterable<ShownTab<T>> {
    return this.tabs.values();
  }
}
