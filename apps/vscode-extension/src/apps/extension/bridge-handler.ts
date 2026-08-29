import type * as vscode from "vscode";
import { configBridge } from "@/kernel/bridge/config.ts";
import { mapsHandlers } from "@/features/maps/index.extension.ts";
import { createBridgeServer } from "@/shared/bridge/server.ts";
import { webviewTransport } from "@/shared/bridge/transport.ts";

/** Where features meet the bridge. Nothing below apps decides what the host answers. */
export function serveBridge(webview: vscode.Webview): () => void {
  return createBridgeServer(configBridge, webviewTransport(webview), {
    ...mapsHandlers(),
  });
}
