import * as vscode from "vscode";
import type { Shell } from "../pure-model/shell.ts";
import { quoteArg, quotePrompt, shellOf, singleLine } from "../pure-model/shell.ts";
import { freeName, stageName } from "../pure-model/names.ts";

/**
 * Терминал — сессия: пока он открыт, агент помнит разговор, закрыли — сессия кончилась.
 * На диск ничего не пишется.
 *
 * Заводится он на объект (решение 0017), и объект переживает не один разговор. Поэтому имя
 * несёт номер: второй терминал того же объекта — это второй терминал, а не перезапуск первого.
 *
 * Ключ при этом не имя, а идентификатор: имя меняется, пока идёт этап, и адресом служить не
 * может. Адрес объекта лежит рядом, чтобы список у объекта был его собственным, а не общим.
 */
type Session = {
  id: string;
  address: string;
  name: string;
  terminal: vscode.Terminal;
};

const sessions = new Map<string, Session>();
let counter = 0;

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

function alive(id: string): Session | undefined {
  const session = sessions.get(id);
  if (session && vscode.window.terminals.includes(session.terminal)) return session;
  sessions.delete(id);
  return undefined;
}

const living = (): Session[] => [...sessions.keys()].flatMap((id) => alive(id) ?? []);

const ofObject = (address: string): Session[] =>
  living().filter((session) => session.address === address);

export function openTerminal(params: {
  name: string;
  address: string;
  cwd: string;
  prompt: string;
  fresh?: boolean;
}): { id: string; name: string } {
  const chosen = params.fresh ? undefined : pickSession(params.address);
  const existing = chosen && alive(chosen.id);
  if (existing) {
    existing.terminal.show();
    // The session is already running, so the prompt goes to the agent rather than to a shell:
    // no `claude` in front of it, and one line, because the agent submits on Enter.
    existing.terminal.sendText(singleLine(params.prompt));
    return { id: existing.id, name: existing.name };
  }

  // Старый не трогаем: разговор в нём мог идти час, и «новый терминал» — просьба добавить,
  // а не начать заново. Закрыть его можно из того же меню.
  const names = new Set(living().map((session) => session.name));
  const name = freeName(params.name, (candidate) => names.has(candidate));
  const terminal = vscode.window.createTerminal({ name, cwd: params.cwd });
  counter += 1;
  const id = `t${counter}`;
  sessions.set(id, { id, address: params.address, name, terminal });

  terminal.show();
  // One argument, quoted the way this shell wants it — decision 0002 counts on the agent
  // reading the prompt as written, line breaks and all.
  // Флаг идёт после промпта: `--mcp-config` принимает несколько значений подряд и съедает
  // следующий позиционный аргумент — промпт уезжал бы в него вместо агента.
  const shell = shellOf(vscode.env.shell);
  terminal.sendText(`claude ${quotePrompt(params.prompt, shell)}${mcpFlag(shell)}`);
  return { id, name };
}

/** Показать уже открытый терминал, ничего в него не отправляя. */
export function showTerminal(params: { id: string }): void {
  alive(params.id)?.terminal.show();
}

export function listTerminals(params: { address: string }): { id: string; name: string }[] {
  return ofObject(params.address).map((session) => ({ id: session.id, name: session.name }));
}

export function closeTerminal(params: { id: string }): void {
  alive(params.id)?.terminal.dispose();
  sessions.delete(params.id);
}

/**
 * Кому кнопка отправляет фразу: активный терминал этого объекта, иначе первый живой, иначе
 * никто — и тогда зовущий заводит новый (решение 0017). Чужие терминалы получателями не
 * бывают: фраза, уехавшая в соседний разговор, выглядит как поломка карты.
 */
export function pickSession(address: string): { id: string; name: string } | undefined {
  const own = ofObject(address);
  const active = own.find((session) => session.terminal === vscode.window.activeTerminal);
  const chosen = active ?? own[0];
  return chosen && { id: chosen.id, name: chosen.name };
}

/** Отправить текст в живую сессию: без `claude` впереди и одной строкой — агент шлёт по Enter. */
export function sendToTerminal(params: { id: string; text: string }): void {
  const session = alive(params.id);
  if (!session) return;
  session.terminal.show();
  session.terminal.sendText(singleLine(params.text));
}

/**
 * Имя вкладки на время этапа. `Terminal.name` только для чтения, поэтому переименование идёт
 * командой редактора — а она работает над активным терминалом, отсюда `show()` перед ней.
 * Не вышло — запуск всё равно состоялся: имя вкладки не повод ронять этап.
 */
export async function renameForStage(params: {
  id: string;
  base: string;
  directive: string;
  stage: string;
  done?: boolean;
}): Promise<void> {
  const session = alive(params.id);
  if (!session) return;

  const name = stageName(params);
  session.terminal.show();
  try {
    await vscode.commands.executeCommand("workbench.action.terminal.renameWithArg", { name });
    session.name = name;
  } catch (error) {
    console.warn("mapward: терминал переименовать не удалось", error);
  }
}
