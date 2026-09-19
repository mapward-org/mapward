import type { Static, TSchema } from "typebox";
import type { Observable } from "rxjs";

/** A call with one answer. */
export type BridgeMethod<P extends TSchema = TSchema, R extends TSchema = TSchema> = {
  kind: "method";
  params: P;
  result: R;
};

/** A stream of answers until the caller lets go. */
export type BridgeSubscription<P extends TSchema = TSchema, E extends TSchema = TSchema> = {
  kind: "subscription";
  params: P;
  event: E;
};

export type BridgeEntry = BridgeMethod | BridgeSubscription;
export type BridgeContract = Record<string, BridgeEntry>;

export const createBridgeMethod = <P extends TSchema, R extends TSchema>(
  params: P,
  result: R,
): BridgeMethod<P, R> => ({ kind: "method", params, result });

export const createBridgeSubscription = <P extends TSchema, E extends TSchema>(
  params: P,
  event: E,
): BridgeSubscription<P, E> => ({ kind: "subscription", params, event });

/** Identity at runtime — the point is the type, shared by both sides. */
export const createBridge = <C extends BridgeContract>(contract: C): C => contract;

export type BridgeClient<C extends BridgeContract> = {
  [K in keyof C]: C[K] extends BridgeMethod<infer P, infer R>
    ? (params: Static<P>) => Promise<Static<R>>
    : C[K] extends BridgeSubscription<infer P, infer E>
      ? (params: Static<P>) => Observable<Static<E>>
      : never;
};

export type BridgeHandlers<C extends BridgeContract> = {
  [K in keyof C]: C[K] extends BridgeMethod<infer P, infer R>
    ? (params: Static<P>) => Static<R> | Promise<Static<R>>
    : C[K] extends BridgeSubscription<infer P, infer E>
      ? (params: Static<P>) => Observable<Static<E>>
      : never;
};
