import { currentScreen, type History } from "../pure-model/navigation.ts";

type Place = { mapPath: string; basePath: string; name: string; address: string };

/**
 * История таба — решение 0036. Хранит её сам вебвью, а хосту таб сообщает, что сейчас на
 * экране: имя вкладки идёт за тем, куда ушли, а не за тем, на чём таб открыли (решение 0026).
 */
export class TabHistory<T extends Place & { history?: History }> {
  constructor(
    private readonly target: T,
    private readonly host: { showingInTab(place: Place & { metric?: string }): void },
    private readonly onTarget?: (target: T) => void,
  ) {}

  save(history: History): void {
    this.onTarget?.({ ...this.target, history });

    const screen = currentScreen(history);
    this.host.showingInTab({
      mapPath: this.target.mapPath,
      basePath: this.target.basePath,
      name: this.target.name,
      address: screen.address,
      ...(screen.solo === undefined ? {} : { metric: screen.solo }),
    });
  }
}
