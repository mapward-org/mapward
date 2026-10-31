import type { Observable } from "rxjs";
import type { AppBridge, BridgeClient } from "@mapward/core";
import { Reactive } from "../../../lib/store/reactive.ts";

/** `run` — сразу экран прогонов с этим прогоном: так ведёт пункт экшона в ленте. */
export type FocusRequest = { mapPath: string; address: string; run?: string };
export type FocusTarget = Omit<FocusRequest, "mapPath">;

/**
 * Просьба перейти к объекту — кнопка «к объекту» в файле директивы или пункт экшона в ленте.
 * Сайдбар держит её, пока не выполнит: карта может быть свёрнута, история не прочитана, объект
 * ещё не загружен.
 *
 * Не `Feed`: тот одинаковое значение дальше не пускает, а второе нажатие на тот же объект,
 * после того как в сайдбаре ушли в сторону, — такая же просьба, как первая. Каждая просьба —
 * новый объект, и `State` её не глотает.
 */
export class FocusInbox extends Reactive {
  /** Ещё не выполненная просьба. */
  private readonly waiting = this.state<FocusRequest | undefined>(undefined);
  /**
   * Последняя пришедшая, выполнена она или нет: по ней раскрывается секция карты. Выполниться
   * просьба может раньше, чем секция раскрылась, — если карта в ней уже загружена.
   */
  private readonly latest = this.state<FocusRequest | undefined>(undefined);

  private stop: (() => void) | undefined;

  constructor(private readonly bridge: BridgeClient<AppBridge>) {
    super();
  }

  get pending(): FocusRequest | undefined {
    return this.waiting.value;
  }

  get last(): FocusRequest | undefined {
    return this.latest.value;
  }

  /** Последняя просьба потоком — с текущей в начале. */
  get last$(): Observable<FocusRequest | undefined> {
    return this.latest.value$;
  }

  /** Хост слушается, пока жив клиент. Табу просьбы не шлют — у него подписка пустая. */
  mount(): void {
    const subscription = this.bridge.watchFocus(undefined).subscribe((request) => {
      this.receive(request);
    });
    this.stop = () => subscription.unsubscribe();
  }

  unmount(): void {
    this.stop?.();
    this.stop = undefined;
  }

  receive(request: FocusRequest): void {
    this.waiting.set(request);
    this.latest.set(request);
  }

  /** Куда просили перейти в этой карте, если просьба ещё не выполнена. */
  pendingFor(mapPath: string): FocusTarget | undefined {
    const pending = this.pending;
    if (pending?.mapPath !== mapPath) return undefined;
    return pending.run === undefined
      ? { address: pending.address }
      : { address: pending.address, run: pending.run };
  }

  /** Просьба выполнена — её больше нет. */
  take(): void {
    this.waiting.set(undefined);
  }
}
