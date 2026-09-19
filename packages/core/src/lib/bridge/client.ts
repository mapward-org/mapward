import { Observable } from "rxjs";
import type { BridgeClient, BridgeContract } from "../../contracts/bridge.ts";
import { type BridgeTransport, nextId } from "../../contracts/protocol.ts";

/**
 * Turns a contract into callable methods: a method becomes a promise, a subscription an
 * observable that tells the other side when nobody listens any more.
 */
export function createBridgeClient<C extends BridgeContract>(
  contract: C,
  transport: BridgeTransport,
): BridgeClient<C> {
  const calls = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const streams = new Map<
    string,
    { next: (value: unknown) => void; error: (error: Error) => void }
  >();

  transport.onMessage((message) => {
    if (message.kind === "result") {
      calls.get(message.id)?.resolve(message.value);
      calls.delete(message.id);
    } else if (message.kind === "failure") {
      calls.get(message.id)?.reject(new Error(message.message));
      calls.delete(message.id);
      streams.get(message.id)?.error(new Error(message.message));
      streams.delete(message.id);
    } else if (message.kind === "event") {
      streams.get(message.id)?.next(message.value);
    }
  });

  const client = {} as Record<string, unknown>;

  for (const [method, entry] of Object.entries(contract)) {
    if (entry.kind === "method") {
      client[method] = (params: unknown) =>
        new Promise((resolve, reject) => {
          const id = nextId();
          calls.set(id, { resolve, reject });
          transport.post({ kind: "call", id, method, params });
        });
    } else {
      client[method] = (params: unknown) =>
        new Observable((subscriber) => {
          const id = nextId();
          streams.set(id, {
            next: (value) => subscriber.next(value),
            error: (error) => subscriber.error(error),
          });
          transport.post({ kind: "subscribe", id, method, params });
          return () => {
            streams.delete(id);
            transport.post({ kind: "unsubscribe", id });
          };
        });
    }
  }

  return client as BridgeClient<C>;
}
