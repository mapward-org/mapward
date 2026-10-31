import type { Observable } from "rxjs";
import type { AppBridge, BridgeClient, ComponentBuild } from "@mapward/core";
import { Feed } from "../../../lib/store/feed.ts";

type Ref = { mapPath: string; basePath: string; name: string };

/** Сборка без подписки не протухает молча: подписка заново пришлёт текущую, и та её заменит. */
const KEEP = { keep: true };

/**
 * Собранные компоненты метрик, раскладки групп и своих форм экшонов — решение 0037. Собирает
 * сервер, подписка приносит новую сборку, когда меняется компонент или то, что он импортирует.
 * Подписка на сборку — ресурс: клетка ушла с экрана — подписки нет. Последнюю сборку ресурс
 * помнит и без подписки: вернулись на вкладку — компонент рисуется сразу, а не «собирается»,
 * пока сервер отвечает заново. Хранилище одно на вид объекта: его заводит точка входа.
 */
export class ComponentBuilds {
  private readonly builds = new Map<string, Feed<ComponentBuild>>();
  private readonly layouts = new Map<string, Feed<ComponentBuild>>();
  private readonly actionForms = new Map<string, Feed<ComponentBuild>>();

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly ref: Ref,
  ) {}

  /** Сборка компонента метрики: `value` — `undefined`, пока сборка ещё идёт. */
  of(metric: string): Feed<ComponentBuild> {
    let build = this.builds.get(metric);
    if (!build) {
      // Мост отдаёт значение подписки без типа: что в нём сборка, обещает контракт.
      build = new Feed(
        this.bridge.watchComponent({ ...this.ref, metric }) as Observable<ComponentBuild>,
        KEEP,
      );
      this.builds.set(metric, build);
    }
    return build;
  }

  /** Сборка своей формы экшона — тем же сервером и так же ресурсом, пока форма открыта. */
  actionForm(action: string): Feed<ComponentBuild> {
    let build = this.actionForms.get(action);
    if (!build) {
      build = new Feed(
        this.bridge.watchActionForm({ ...this.ref, action }) as Observable<ComponentBuild>,
        KEEP,
      );
      this.actionForms.set(action, build);
    }
    return build;
  }

  /**
   * Сборка раскладки группы — тем же сервером и так же ресурсом: группа ушла с экрана, на ресурс
   * больше никто не подписан — сборка больше не нужна.
   */
  layout(address: string, group: string): Feed<ComponentBuild> {
    const key = JSON.stringify([address, group]);
    let build = this.layouts.get(key);
    if (!build) {
      build = new Feed(
        this.bridge.watchLayout({ ...this.ref, address, group }) as Observable<ComponentBuild>,
        KEEP,
      );
      this.layouts.set(key, build);
    }
    return build;
  }
}
