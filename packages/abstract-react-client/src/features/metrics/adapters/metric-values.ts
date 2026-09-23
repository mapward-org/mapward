import { Resource } from "@mapward/core";
import type { AppBridge, BridgeClient, MapMetric } from "@mapward/core";

export type Collected = {
  updatedAt?: string;
  ok?: boolean;
  data?: unknown;
  busy?: boolean;
  /** Собранное ещё поднимается с диска: ответа пока нет (решение 0041). */
  loading?: boolean;
  /** Что не прошло схему компонента — решение 0037. */
  invalid?: string[];
};
export type Snapshot = Record<string, Collected>;

type Ref = { mapPath: string; basePath: string; name: string };
type View = { address: string; group?: string | undefined; solo?: string | undefined };

/**
 * Значения метрик открытой вкладки — решение 0013: их держит сервер, клиент подписывается. Сама
 * подписка и означает «вкладка открыта»: пока её читают, сервер держит метрики свежими, а
 * отписка гасит таймеры. Вкладка — это и есть «что открыто»: её имя едет в подписку, и сервер
 * собирает только её метрики (решение 0025); таб одной метрики поднимает её одну (0026).
 *
 * Подписка — ресурс (решение 0042): открыли другую вкладку — читается другой ресурс, а прежний,
 * которого больше никто не читает, отписывается сам.
 */
export class MetricValues {
  private readonly resources = new Map<string, Resource<unknown>>();

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly ref: Ref,
    private readonly view: () => View,
  ) {}

  /** Значения по адресу метрики; пока снимка нет — пусто. */
  get values(): Snapshot {
    const view = this.view();
    const key = `${view.address}|${view.group ?? ""}|${view.solo ?? ""}`;
    let resource = this.resources.get(key);
    if (!resource) {
      resource = new Resource((next) => {
        const subscription = this.bridge
          .watchMetrics({
            ...this.ref,
            address: view.address,
            ...(view.group === undefined ? {} : { group: view.group }),
            ...(view.solo === undefined ? {} : { metrics: [view.solo] }),
          })
          .subscribe(next);
        return () => subscription.unsubscribe();
      });
      this.resources.set(key, resource);
    }
    return (resource.value as Snapshot | undefined) ?? {};
  }

  /** Кнопка обновления: прогон целиком, мимо свежести. */
  run(metric: MapMetric): void {
    void this.bridge.runMetric({ ...this.ref, metric: metric.address });
  }
}
