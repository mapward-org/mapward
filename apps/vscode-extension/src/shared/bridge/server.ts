import type { Subscription } from "rxjs";
import { Check } from "typebox/value";
import type { BridgeContract, BridgeHandlers } from "./contract.ts";
import type { BridgeTransport } from "./protocol.ts";

/**
 * Runs handlers for the other side. Params are validated on arrival: the two bundles are
 * built separately, and in watch mode one of them is routinely a version behind.
 */
export function createBridgeServer<C extends BridgeContract>(
  contract: C,
  transport: BridgeTransport,
  handlers: BridgeHandlers<C>,
): () => void {
  const streams = new Map<string, Subscription>();

  const stop = transport.onMessage((message) => {
    if (message.kind === "call" || message.kind === "subscribe") {
      const entry = contract[message.method];
      if (!entry) {
        transport.post({
          kind: "failure",
          id: message.id,
          message: `Unknown method ${message.method}`,
        });
        return;
      }
      if (!Check(entry.params, message.params)) {
        transport.post({
          kind: "failure",
          id: message.id,
          message: `Bad params for ${message.method}`,
        });
        return;
      }

      const handler = handlers[message.method] as (params: unknown) => unknown;

      if (message.kind === "call") {
        void Promise.resolve(handler(message.params)).then(
          (value) => transport.post({ kind: "result", id: message.id, value }),
          (error: unknown) =>
            transport.post({
              kind: "failure",
              id: message.id,
              message: error instanceof Error ? error.message : String(error),
            }),
        );
      } else {
        const stream = handler(message.params) as {
          subscribe: (next: (value: unknown) => void) => Subscription;
        };
        streams.set(
          message.id,
          stream.subscribe((value) => transport.post({ kind: "event", id: message.id, value })),
        );
      }
    } else if (message.kind === "unsubscribe") {
      streams.get(message.id)?.unsubscribe();
      streams.delete(message.id);
    }
  });

  return () => {
    for (const subscription of streams.values()) subscription.unsubscribe();
    streams.clear();
    stop();
  };
}
