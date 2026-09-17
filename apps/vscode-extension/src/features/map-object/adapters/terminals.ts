import * as vscode from "vscode";
import { quotePrompt, shellOf, singleLine } from "../pure-model/shell.ts";

/**
 * A terminal is the session. Nothing is stored on disk: while the terminal lives, the agent
 * remembers the conversation; closing it ends the session. That is why a repeated run of one
 * directive reuses its terminal — check, dry run and run warm the same context.
 */
const byName = new Map<string, vscode.Terminal>();

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
  terminal.sendText(`claude ${quotePrompt(params.prompt, shellOf(vscode.env.shell))}`);
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
