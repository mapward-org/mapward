/**
 * Codicons are the editor's own icon set, but the file icon theme a person chose is not
 * reachable from a webview: it lives in the editor chrome, and a webview is an isolated
 * document. So the mapping from extension to icon is ours.
 */
const BY_EXTENSION: Record<string, string> = {
  json: "json",
  md: "markdown",
  ts: "file-code",
  tsx: "file-code",
  js: "file-code",
  mjs: "file-code",
  cjs: "file-code",
  css: "symbol-color",
  html: "code",
  yml: "settings",
  yaml: "settings",
  toml: "settings",
  lock: "lock",
  png: "file-media",
  jpg: "file-media",
  jpeg: "file-media",
  svg: "file-media",
  gif: "file-media",
  ttf: "text-size",
  sh: "terminal",
};

const BY_NAME: Record<string, string> = {
  "package.json": "package",
  "pnpm-lock.yaml": "lock",
  "mapward.json": "map",
  ".gitignore": "source-control",
  "readme.md": "book",
};

export function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return "folder";
  const byName = BY_NAME[name.toLowerCase()];
  if (byName) return byName;
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? "file";
}
