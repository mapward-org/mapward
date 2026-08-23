/**
 * Core: the map model. Reads folders, validates them, exposes the structure.
 *
 * Nothing about VSCode, the UI or running agents belongs here: the core is used by every app alike.
 * The implementation follows the spec — for now only the package boundary is fixed.
 */
export const VERSION = "0.0.0";

/** One entry of a folder — the only shape the model needs to walk a map. */
export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

/**
 * Where a map is read from. Packages never import `node:fs`, `vscode` or touch the DOM: an app binds
 * the real environment and passes it in. That is what lets the same core run in a terminal, inside
 * the extension and in a browser without forking. The set of operations grows with the spec.
 */
export interface Environment {
  readDirectory(path: string): Promise<DirectoryEntry[]>;
  readTextFile(path: string): Promise<string>;
}
