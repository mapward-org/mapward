import { action, makeObservable, observableRef } from "mobx";
import type { AppBridge, BridgeClient } from "@mapward/core";

type FocusRequest = { mapPath: string; address: string };

/**
 * Просьба хоста перейти к объекту — кнопка «к объекту» в файле директивы. Сайдбар держит её,
 * пока не выполнит: карта может быть свёрнута, история не прочитана, объект ещё не загружен.
 *
 * Не `Resource`: тот одинаковое значение дальше не пускает, а второе нажатие на тот же объект,
 * после того как в сайдбаре ушли в сторону, — такая же просьба, как первая.
 */
export class FocusInbox {
  /** Ещё не выполненная просьба. */
  pending: FocusRequest | undefined = undefined;
  /**
   * Последняя пришедшая, выполнена она или нет: по ней раскрывается секция карты. Выполниться
   * просьба может раньше, чем секция раскрылась, — если карта в ней уже загружена.
   */
  last: FocusRequest | undefined = undefined;

  constructor(private readonly bridge: BridgeClient<AppBridge>) {
    makeObservable(this, {
      pending: observableRef,
      last: observableRef,
      receive: action,
      take: action,
    });
  }

  private stop: (() => void) | undefined;

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
    this.pending = request;
    this.last = request;
  }

  /** Адрес, к которому просили перейти в этой карте, если просьба ещё не выполнена. */
  pendingFor(mapPath: string): string | undefined {
    return this.pending?.mapPath === mapPath ? this.pending.address : undefined;
  }

  /** Просьба выполнена — её больше нет. */
  take(): void {
    this.pending = undefined;
  }
}
