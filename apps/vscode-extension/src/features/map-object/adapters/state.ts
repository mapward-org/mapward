import * as vscode from "vscode";

const MAP_STATE = "map-state.json";

/** The editor's own storage: per person, per workspace, never in git. */
export function viewState(memento: vscode.Memento) {
  return {
    get: (params: { key: string }): unknown => memento.get(params.key),
    set: async (params: { key: string; value: unknown }): Promise<void> => {
      await memento.update(params.key, params.value);
    },
  };
}

/** Node positions live with the map, so everyone opens the same picture. */
export async function readMapState(params: { mapPath: string }): Promise<unknown> {
  const uri = vscode.Uri.joinPath(vscode.Uri.file(params.mapPath), MAP_STATE);
  try {
    return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
  } catch {
    return {};
  }
}

export async function writeMapState(params: { mapPath: string; value: unknown }): Promise<void> {
  const uri = vscode.Uri.joinPath(vscode.Uri.file(params.mapPath), MAP_STATE);
  await vscode.workspace.fs.writeFile(
    uri,
    new TextEncoder().encode(JSON.stringify(params.value, null, 2) + "\n"),
  );
}
