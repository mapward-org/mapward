import type * as vscode from "vscode";
import { appBridge } from "@/kernel/bridge/app.ts";
import { mapsHandlers } from "@/features/maps/index.extension.ts";
import { mapObjectHandlers } from "@/features/map-object/index.extension.ts";
import { createBridgeServer } from "@/shared/bridge/server.ts";
import { webviewTransport } from "@/shared/bridge/transport.ts";

/** Where features meet the bridge. Nothing below apps decides what the host answers. */
export function serveBridge(webview: vscode.Webview): () => void {
  return createBridgeServer(appBridge, webviewTransport(webview), {
    ...mapsHandlers(),
    ...mapObjectHandlers(),
  });
}
