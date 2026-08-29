/**
 * Messages crossing the postMessage boundary. Types live in the kernel because both runtimes
 * depend on them and neither owns them.
 */
export type ToExtension = { kind: "ping" };

export type ToWebview = { kind: "pong"; at: string };
