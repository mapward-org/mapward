import * as vscode from "vscode";
import type { Shell } from "../pure-model/shell.ts";
import { quoteArg, quotePrompt, shellOf, singleLine } from "../pure-model/shell.ts";

/**
 * A terminal is the session. Nothing is stored on disk: while the terminal lives, the agent
 * remembers the conversation; closing it ends the session. That is why a repeated run of one
 * directive reuses its terminal — check, dry run and run warm the same context.
 */
const byName = new Map<string, vscode.Terminal>();

/**
 * Адрес MCP-сервера карты — решение 0009: расширение подставляет его в `--mcp-config` при
 * запуске агента. `--strict-mcp-config` не ставим: чужие серверы в сессии пока не мешают.
 */
let mcpUrl: string | undefined;

export function setMcpUrl(url: string | undefined): void {
  mcpUrl = url;
}

const mcpFlag = (shell: Shell): string => {
  if (!mcpUrl) return "";
  const config = JSON.stringify({ mcpServers: { mapward: { type: "http", url: mcpUrl } } });
  return ` --mcp-config ${quoteArg(config, shell)}`;
};

function alive(name: string): vscode.Terminal | undefined {
  const terminal = byName.get(name);
  if (terminal && vscode.window.terminals.includes(terminal)) return terminal;
  byName.delete(name);
  return undefined;
}

export function openTerminal(params: {
  name: string;
  cwd: string;
  prompt: string;
  fresh?: boolean;
}): { name: string } {
  if (params.fresh) alive(params.name)?.dispose();

  const existing = params.fresh ? undefined : alive(params.name);
  if (existing) {
    existing.show();
    // The session is already running, so the prompt goes to the agent rather than to a shell:
    // no `claude` in front of it, and one line, because the agent submits on Enter.
    existing.sendText(singleLine(params.prompt));
    return { name: params.name };
  }

  const terminal = vscode.window.createTerminal({ name: params.name, cwd: params.cwd });
  byName.set(params.name, terminal);

  terminal.show();
  // One argument, quoted the way this shell wants it — decision 0002 counts on the agent
  // reading the prompt as written, line breaks and all.
  // Флаг идёт после промпта: `--mcp-config` принимает несколько значений подряд и съедает
  // следующий позиционный аргумент — промпт уезжал бы в него вместо агента.
  const shell = shellOf(vscode.env.shell);
  terminal.sendText(`claude ${quotePrompt(params.prompt, shell)}${mcpFlag(shell)}`);
  return { name: params.name };
}

export function listTerminals(params: { prefix: string }): { name: string }[] {
  return [...byName.keys()]
    .filter((name) => name.startsWith(params.prefix) && alive(name))
    .map((name) => ({ name }));
}

export function closeTerminal(params: { name: string }): void {
  alive(params.name)?.dispose();
  byName.delete(params.name);
}
