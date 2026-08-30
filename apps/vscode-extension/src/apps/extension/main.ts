import * as vscode from "vscode";
import { MapViewProvider } from "./map-view.ts";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MapViewProvider.viewId,
      new MapViewProvider(context.extensionUri, context.workspaceState),
      // The map keeps where you are; rebuilding it on every sidebar switch would lose that.
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
}

export function deactivate(): void {}
