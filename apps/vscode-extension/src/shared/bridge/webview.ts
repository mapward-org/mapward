import type { ToExtension, ToWebview } from "../../kernel/bridge.ts";

type VsCodeApi = { postMessage: (message: unknown) => void };

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * The webview side. `acquireVsCodeApi` may be called only once per page, so the handle is
 * taken here and shared.
 */
const api = acquireVsCodeApi();

export const bridgeToExtension = {
  // Not window.postMessage: this is the host handle, it takes no targetOrigin.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  post: (message: ToExtension) => api.postMessage(message),
  onMessage: (handler: (message: ToWebview) => void) => {
    const listener = (event: MessageEvent<ToWebview>) => handler(event.data);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  },
};
