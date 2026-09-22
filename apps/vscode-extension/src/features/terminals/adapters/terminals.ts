import * as vscode from "vscode";
import type { Shell } from "../pure-model/shell.ts";
import { quoteArg, quotePrompt, shellOf, singleLine } from "../pure-model/shell.ts";
import { freeName, stageName } from "../pure-model/names.ts";
import { chooseRecipient } from "../pure-model/recipient.ts";

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
 * Где директиву последний раз запускали кнопкой — решение 0032. По концу этапа не стирается:
 * иначе второй круг его бы уже не застал. Живёт в памяти редактора — после перезапуска
 * терминалы всё равно закрыты. Ключ — адрес вместе с файлом: имена директив у разных
 * объектов совпадают.
 */
const lastRun = new Map<string, string>();
const directiveKey = (address: string, directive: string) => `${address}\n${directive}`;

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

/**
 * Пауза между текстом и Enter. Текст, пришедший одним куском вместе с Enter, агент принимает за
 * вставку из буфера, и Enter в ней — перенос строки внутри поля ввода, а не отправка: фраза
 * вставлялась и не запускалась. Отдельный Enter после паузы агент видит нажатием клавиши.
 */
const SUBMIT_DELAY_MS = 150;

/** Набрать фразу в живую сессию и нажать Enter: одной строкой — агент шлёт по каждому Enter. */
async function submit(terminal: vscode.Terminal, text: string): Promise<void> {
  terminal.sendText(singleLine(text), false);
  await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
  terminal.sendText("\r", false);
}

export async function openTerminal(params: {
  name: string;
  address: string;
  cwd: string;
  prompt: string;
  fresh?: boolean;
  /** Показать терминал, не забирая курсор: кнопка этапа оставляет человека там, где он был. */
  preserveFocus?: boolean;
}): Promise<{ id: string; name: string }> {
  const chosen = params.fresh ? undefined : pickSession(params.address);
  const existing = chosen && alive(chosen.id);
  if (existing) {
    existing.terminal.show(params.preserveFocus);
    // The session is already running, so the prompt goes to the agent rather than to a shell:
    // no `claude` in front of it.
    await submit(existing.terminal, params.prompt);
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

  terminal.show(params.preserveFocus);
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
 * Кому кнопка «терминал» на объекте отправляет промпт: активный терминал этого объекта, иначе
 * первый живой, иначе никто — и тогда зовущий заводит новый (решение 0017). Чужие терминалы
 * получателями не бывают: фраза, уехавшая в соседний разговор, выглядит как поломка карты.
 */
export function pickSession(address: string): { id: string; name: string } | undefined {
  return pickFor({ address });
}

/** Получатель кнопки этапа: сперва терминал последнего запуска этой директивы — решение 0032. */
export function pickStageSession(params: {
  address: string;
  directive: string;
}): { id: string; name: string } | undefined {
  return pickFor({
    address: params.address,
    remembered: lastRun.get(directiveKey(params.address, params.directive)),
  });
}

function pickFor(params: {
  address: string;
  remembered?: string;
}): { id: string; name: string } | undefined {
  const own = ofObject(params.address);
  const id = chooseRecipient({
    remembered: params.remembered,
    own: own.map((session) => ({
      id: session.id,
      active: session.terminal === vscode.window.activeTerminal,
    })),
  });
  const chosen = own.find((session) => session.id === id);
  return chosen && { id: chosen.id, name: chosen.name };
}

/** Запомнить, куда кнопка отправила этап этой директивы. */
export function rememberDirectiveRun(params: {
  address: string;
  directive: string;
  id: string;
}): void {
  lastRun.set(directiveKey(params.address, params.directive), params.id);
}

/**
 * Отправить фразу в живую сессию. Терминал показывается, но курсор остаётся где был: агент
 * отвечает в файл директивы, и человек дописывает свой ответ там же — решение 0032.
 */
export async function sendToTerminal(params: { id: string; text: string }): Promise<void> {
  const session = alive(params.id);
  if (!session) return;
  session.terminal.show(true);
  await submit(session.terminal, params.text);
}

/**
 * Имя вкладки на время этапа. `Terminal.name` только для чтения, поэтому переименование идёт
 * командой редактора — а она работает над активным терминалом, отсюда `show()` перед ней.
 * Показываем, не забирая курсор: переименование не повод уводить человека из файла.
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
  session.terminal.show(true);
  try {
    await vscode.commands.executeCommand("workbench.action.terminal.renameWithArg", { name });
    session.name = name;
  } catch (error) {
    console.warn("mapward: терминал переименовать не удалось", error);
  }
}
