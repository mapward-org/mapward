import { Resource } from "@mapward/core";
import type { AppBridge, BridgeClient, Run } from "@mapward/core";
import { lastRun, runningCount } from "../pure-model/runs.ts";

const NONE: Run[] = [];

/**
 * Прогоны открытого объекта — решение 0038: держит сервер, клиент подписывается. Идущий прогон
 * меняется у сервера на каждом шаге, и подписка приносит его заново — экран обновляется живьём.
 * Ими питаются экран прогонов, числа у кнопок экшонов и красная точка метрики: подписка одна на
 * вид. Открыли другой объект — читается другой ресурс, прежний отписывается сам.
 */
export class ObjectRuns {
  private readonly resources = new Map<string, Resource<Run[]>>();

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly mapPath: string,
    private readonly address: () => string,
  ) {}

  get list(): Run[] {
    const address = this.address();
    let resource = this.resources.get(address);
    if (!resource) {
      resource = new Resource<Run[]>((next) => {
        const subscription = this.bridge
          .watchRuns({ mapPath: this.mapPath, address })
          .subscribe(next);
        return () => subscription.unsubscribe();
      });
      this.resources.set(address, resource);
    }
    return resource.value ?? NONE;
  }

  /** Сколько прогонов цели идёт сейчас: прогоны одного экшона бывают параллельными. */
  running(target: string): number {
    return runningCount(this.list, target);
  }

  /** Последний прогон экшона или метрики: на него ведёт красная точка метрики. */
  last(target: string): Run | undefined {
    return lastRun(this.list, target);
  }

  stop(id: string): void {
    void this.bridge.stopRun({ mapPath: this.mapPath, id });
  }
}
