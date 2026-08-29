import type * as vscode from "vscode";
import type { ToExtension, ToWebview } from "../../kernel/bridge.ts";

/** The host side of the bridge: a webview in, a typed channel out. */
export function bridgeToWebview(webview: vscode.Webview) {
  return {
    // Not window.postMessage: the vscode webview channel has no targetOrigin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    post: (message: ToWebview) => void webview.postMessage(message),
    onMessage: (handler: (message: ToExtension) => void) =>
      webview.onDidReceiveMessage((message: ToExtension) => handler(message)),
  };
}
