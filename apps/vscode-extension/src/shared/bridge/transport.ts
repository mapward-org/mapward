import { type BridgeTransport, isEnvelope } from "@mapward/core";

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  /** Состояние вебвью: редактор отдаёт его обратно, когда восстанавливает таб (решение 0026). */
  getState: () => unknown;
  setState: (value: unknown) => void;
};
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
 * here and shared: и мосту, и сохранению состояния таба достаётся один и тот же.
 */
let handle: VsCodeApi | undefined;

export function vsCodeApi(): VsCodeApi {
  handle ??= (globalThis as unknown as { acquireVsCodeApi: () => VsCodeApi }).acquireVsCodeApi();
  return handle;
}

export function extensionTransport(): BridgeTransport {
  const api = vsCodeApi();
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
