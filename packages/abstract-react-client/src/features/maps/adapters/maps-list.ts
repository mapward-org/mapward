import { Resource } from "@mapward/core";
import type { AppBridge, BridgeClient, MapsState } from "@mapward/core";

/** Карты, видимые хосту: подписка, а не запрос — конфиг меняют руками и агентами. */
export class MapsList {
  private readonly state: Resource<MapsState>;

  constructor(private readonly bridge: BridgeClient<AppBridge>) {
    this.state = new Resource<MapsState>((next) => {
      const subscription = bridge.watchMaps(undefined).subscribe(next);
      return () => subscription.unsubscribe();
    });
  }

  /** Что с картами; пока хост не ответил — `undefined`. */
  get current(): MapsState | undefined {
    return this.state.value;
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
