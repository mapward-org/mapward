import * as vscode from "vscode";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Directives are named by when they were written, so the list sorts itself and a diff shows
 * which one changed. The file opens right away — an empty directive is a prompt to write.
 */
export async function createDirective(params: { objectPath: string }): Promise<{ path: string }> {
  const title = await vscode.window.showInputBox({
    title: "Новая директива",
    prompt: "О чём она — это станет именем файла",
    placeHolder: "например, add feature terminals",
  });
  if (!title) return { path: "" };

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    `${pad(now.getHours())}${pad(now.getMinutes())}`,
  ].join("-");

  const slug = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-zа-я0-9]+/gi, "-")
    .replaceAll(/^-|-$/g, "");

  const uri = vscode.Uri.joinPath(
    vscode.Uri.file(params.objectPath),
    "_directives",
    `${stamp}-${slug}.md`,
  );

  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode("\n## \n\n"));
  await vscode.window.showTextDocument(uri);
  return { path: uri.fsPath };
}
