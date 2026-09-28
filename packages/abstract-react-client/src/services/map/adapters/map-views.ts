import { makeObservable, observableRef, action } from "mobx";
import { mountedMap } from "@mapward/core";
import type {
  AppBridge,
  BridgeClient,
  LiveMap,
  MapsState,
  Mounts,
  ResolvedMap,
} from "@mapward/core";

type Ref = { mapPath: string; basePath: string; name: string };

const keyOf = (ref: Ref) => `${ref.mapPath}|${ref.basePath}|${ref.name}`;

/**
 * Живые карты окна — одна на карту, а не на каждый экран, который её открыл: экраны сайдбара,
 * табов и переходов в подключённую карту делят её. По этому же списку карта находит свои
 * подключения — у клиента та же модель, что у сервера, и подстановки из карты проекта она
 * считает сама. Карта, на которую никто не смотрит, файлов не держит: модель читает только то,
 * что наблюдают. Как собрать живую карту, говорит точка входа — `create`.
 */
export class MapViews<V extends { live: LiveMap }> {
  private readonly views = new Map<string, V>();
  /** Все карты окна — видимые и доступные только подключением; пока хост не ответил — нет. */
  private state: MapsState | undefined = undefined;
  private stop: (() => void) | undefined;

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly create: (ref: Ref, mounts: Mounts) => V,
  ) {
    makeObservable<MapViews<V>, "state" | "receive">(this, {
      state: observableRef,
      receive: action,
    });
  }

  mount(): void {
    const subscription = this.bridge.watchMaps(undefined).subscribe((next) => this.receive(next));
    this.stop = () => subscription.unsubscribe();
  }

  unmount(): void {
    this.stop?.();
    this.stop = undefined;
  }

  private receive(next: MapsState): void {
    this.state = next;
  }

  /** Живая карта по описанию: та же, пока жив клиент. */
  view(ref: Ref): V {
    const key = keyOf(ref);
    const known = this.views.get(key);
    if (known) return known;
    const created = this.create(ref, (name) => {
      const found = this.mounted(ref, name);
      return "error" in found ? found.error : this.view(found).live;
    });
    this.views.set(key, created);
    return created;
  }

  /** Карта, подключённая к `ref` под именем, или почему её нет. */
  mounted(ref: Ref, name: string): ResolvedMap | { error: string } {
    const state = this.state;
    if (state?.kind !== "maps") return { error: "Список карт ещё читается" };
    return mountedMap([...state.maps, ...(state.mounted ?? [])], ref.mapPath, name);
  }
}
