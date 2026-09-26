import { Resource } from "@mapward/core";
import type { AppBridge, BridgeClient, Turn } from "@mapward/core";
import { buttonState } from "../pure-model/turns.ts";

const NONE: Turn[] = [];

/** Куда вести пункт экшона: экран прогонов его объекта, в какой бы карте окна он ни был. */
export type RunFocus = {
  receive(request: { mapPath: string; address: string; run: string }): void;
};

/** Ленту держит сервер, в памяти (решение 0034): клиент только подписывается. */
export class Turns {
  private readonly turns: Resource<Turn[]>;

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly focus: RunFocus | undefined,
    /** Хост с терминалами: только он знает, какой терминал завела кнопка этапа. */
    private readonly terminals: () => boolean,
  ) {
    this.turns = new Resource<Turn[]>((next) => {
      const subscription = bridge.watchTurns(undefined).subscribe(next);
      return () => subscription.unsubscribe();
    });
  }

  get list(): Turn[] {
    return this.turns.value ?? NONE;
  }

  /** Число и лоадер на кнопке: число — что ждёт человека, лоадер — что идёт. */
  get button(): { count: number; busy: boolean } {
    return buttonState(this.list);
  }

  /**
   * Открыл пункт — взял ход. Директива открывается файлом, а её терминал выходит вперёд, если
   * хост его знает; экшон — экраном прогонов с этим прогоном. Ждущее и упавшее после этого
   * уходят, идущее остаётся: оно уйдёт само, когда кончится.
   */
  take(turn: Turn): void {
    if (turn.kind === "directive") {
      void this.bridge.openPath({ path: turn.path });
      if (this.terminals()) {
        void this.bridge.showDirectiveTerminal({
          address: turn.address,
          directive: turn.directive,
        });
      }
      if (turn.state !== "running") {
        void this.bridge.dismissTurn({
          mapPath: turn.mapPath,
          address: turn.address,
          directive: turn.directive,
        });
      }
      return;
    }
    this.focus?.receive({ mapPath: turn.mapPath, address: turn.address, run: turn.run });
    if (turn.state !== "running") {
      void this.bridge.dismissTurn({ mapPath: turn.mapPath, run: turn.run });
    }
  }
}
