import type { AppBridge, BridgeClient, Turn } from "@mapward/core";
import { Feed } from "../../../lib/store/feed.ts";
import { Reactive } from "../../../lib/store/reactive.ts";
import { arrange, buttonState } from "../pure-model/turns.ts";

const NONE: Turn[] = [];

/** Куда вести пункт экшона: экран прогонов его объекта, в какой бы карте окна он ни был. */
export type RunFocus = {
  receive(request: { mapPath: string; address: string; run: string }): void;
};

/** Ленту держит сервер, в памяти (решение 0046): клиент только подписывается. */
export class Turns extends Reactive {
  private readonly turns: Feed<Turn[]>;

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly focus: RunFocus | undefined,
    /** Хост с терминалами: только он знает, какой терминал завела кнопка этапа. */
    private readonly terminals: () => boolean,
  ) {
    super();
    this.turns = new Feed(bridge.watchTurns(undefined));
    this.depend(this.turns);
  }

  get list(): Turn[] {
    return this.turns.value ?? NONE;
  }

  /** Число и лоадер на кнопке: число — что ждёт человека, лоадер — что идёт. */
  get button(): { count: number; busy: boolean } {
    return buttonState(this.list);
  }

  /** Лента группами над кнопкой: идущие сверху, ждущие у кнопки, свежие снизу. */
  get groups(): { running: readonly Turn[]; waiting: readonly Turn[] } {
    return arrange(this.list);
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
    } else {
      this.focus?.receive({ mapPath: turn.mapPath, address: turn.address, run: turn.run });
    }
    this.dismiss(turn);
  }

  /**
   * Убрать пункт, не открывая его, — крестиком: директиву, закрытую своим же этапом, смотреть
   * не обязательно, а из числа на кнопке иначе её не убрать. Идущее не убирается: уйдёт само.
   */
  dismiss(turn: Turn): void {
    if (turn.state === "running") return;
    void this.bridge.dismissTurn(
      turn.kind === "directive"
        ? { mapPath: turn.mapPath, address: turn.address, directive: turn.directive }
        : { mapPath: turn.mapPath, run: turn.run },
    );
  }
}
