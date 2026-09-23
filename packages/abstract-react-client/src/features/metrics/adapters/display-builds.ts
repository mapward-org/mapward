import { Resource } from "@mapward/core";
import type { AppBridge, BridgeClient, DisplayBuild } from "@mapward/core";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Собранные компоненты метрик — решение 0037. Собирает сервер, подписка приносит новую сборку,
 * когда меняется компонент или то, что он импортирует. Подписка на метрику — ресурс: клетка
 * ушла с экрана — сборка больше не нужна.
 */
export class DisplayBuilds {
  private readonly builds = new Map<string, Resource<unknown>>();

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly ref: Ref,
  ) {}

  /** Сборка компонента метрики; `undefined` — ещё идёт. */
  of(metric: string): DisplayBuild | undefined {
    let build = this.builds.get(metric);
    if (!build) {
      build = new Resource((next) => {
        const subscription = this.bridge.watchDisplay({ ...this.ref, metric }).subscribe(next);
        return () => subscription.unsubscribe();
      });
      this.builds.set(metric, build);
    }
    return build.value as DisplayBuild | undefined;
  }
}
