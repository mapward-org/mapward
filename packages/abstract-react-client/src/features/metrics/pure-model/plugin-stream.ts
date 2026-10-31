import type { Observable } from "rxjs";

/**
 * Поток метода плагина — `Observable` из rxjs: компоненту окна rxjs отдаёт клиент той же копией,
 * так что `pipe` и операторы работают с ним как есть.
 */
export type PluginStream<T = unknown> = Observable<T>;
