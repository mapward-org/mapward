import type { AppBridge, BridgeClient, MapsState } from "@mapward/core";
import { Feed } from "../../../lib/store/feed.ts";
import { Reactive } from "../../../lib/store/reactive.ts";

/** Карты, видимые хосту: подписка, а не запрос — конфиг меняют руками и агентами. */
export class MapsList extends Reactive {
  private readonly maps: Feed<MapsState>;

  constructor(private readonly bridge: BridgeClient<AppBridge>) {
    super();
    this.maps = new Feed(bridge.watchMaps(undefined));
    this.depend(this.maps);
  }

  /** Что с картами; пока хост не ответил — `undefined`. */
  get current(): MapsState | undefined {
    return this.maps.value;
  }

  createConfig(): void {
    void this.bridge.createConfig(undefined);
  }

  pickFolder(): void {
    void this.bridge.pickFolder(undefined);
  }

  openPath(path: string): void {
    void this.bridge.openPath({ path });
  }
}
