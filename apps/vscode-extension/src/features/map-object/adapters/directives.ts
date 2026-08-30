import * as vscode from "vscode";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Directives are named by when they were written, so the list sorts itself and a diff shows
 * which one changed. The file opens right away — an empty directive is a prompt to write.
 */
export async function createDirective(params: { objectPath: string }): Promise<{ path: string }> {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    `${pad(now.getHours())}${pad(now.getMinutes())}`,
  ].join("-");

  const uri = vscode.Uri.joinPath(
    vscode.Uri.file(params.objectPath),
    "_directives",
    `${stamp}-directive.md`,
  );

  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode("\n## \n\n"));
  await vscode.window.showTextDocument(uri);
  return { path: uri.fsPath };
}
