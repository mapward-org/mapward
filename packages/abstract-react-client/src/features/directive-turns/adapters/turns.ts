import { Resource } from "@mapward/core";
import type { AppBridge, BridgeClient, Turn } from "@mapward/core";

const NONE: Turn[] = [];

/** Список держит сервер, в памяти (решение 0034): клиент только подписывается. */
export class Turns {
  private readonly turns: Resource<Turn[]>;

  constructor(private readonly bridge: BridgeClient<AppBridge>) {
    this.turns = new Resource<Turn[]>((next) => {
      const subscription = bridge.watchTurns(undefined).subscribe(next);
      return () => subscription.unsubscribe();
    });
  }

  get list(): Turn[] {
    return this.turns.value ?? NONE;
  }

  /** Открыл пункт — взял ход: директива открывается, пункт уходит. */
  take(turn: Turn): void {
    void this.bridge.openPath({ path: turn.path });
    void this.bridge.dismissTurn({
      mapPath: turn.mapPath,
      address: turn.address,
      directive: turn.directive,
    });
  }
}
