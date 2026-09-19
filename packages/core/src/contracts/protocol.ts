/** What actually travels over postMessage. Ids tie a reply back to its call. */
export type Envelope =
  | { kind: "call"; id: string; method: string; params: unknown }
  | { kind: "result"; id: string; value: unknown }
  | { kind: "failure"; id: string; message: string }
  | { kind: "subscribe"; id: string; method: string; params: unknown }
  | { kind: "event"; id: string; value: unknown }
  | { kind: "unsubscribe"; id: string };

/**
 * Both runtimes talk through the same shape, so client and server know nothing about
 * `vscode` or `acquireVsCodeApi`.
 */
export type BridgeTransport = {
  post: (message: Envelope) => void;
  onMessage: (handler: (message: Envelope) => void) => () => void;
};

let counter = 0;
export const nextId = (): string => `${++counter}`;

export function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && "kind" in value && "id" in value;
}
