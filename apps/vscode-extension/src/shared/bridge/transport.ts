import { type BridgeTransport, isEnvelope } from "./protocol.ts";

type VsCodeApi = { postMessage: (message: unknown) => void };
type WebviewLike = {
  postMessage: (message: unknown) => unknown;
  onDidReceiveMessage: (handler: (message: unknown) => void) => { dispose: () => void };
};

/** Host side: a vscode webview handle in, a transport out. */
export function webviewTransport(webview: WebviewLike): BridgeTransport {
  return {
    // Not window.postMessage: the vscode webview channel has no targetOrigin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    post: (message) => void webview.postMessage(message),
    onMessage: (handler) => {
      const subscription = webview.onDidReceiveMessage((message) => {
        if (isEnvelope(message)) handler(message);
      });
      return () => subscription.dispose();
    },
  };
}

/**
 * Webview side. `acquireVsCodeApi` may be called only once per page, so the handle is taken
 * here and shared.
 */
export function extensionTransport(): BridgeTransport {
  const api = (globalThis as unknown as { acquireVsCodeApi: () => VsCodeApi }).acquireVsCodeApi();
  return {
    // Not window.postMessage: this is the host handle, it takes no targetOrigin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    post: (message) => api.postMessage(message),
    onMessage: (handler) => {
      const listener = (event: MessageEvent<unknown>) => {
        if (isEnvelope(event.data)) handler(event.data);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}
