import * as vscode from "vscode";
import type { Shell } from "../pure-model/shell.ts";
import { quoteArg, quotePrompt, shellOf, singleLine } from "../pure-model/shell.ts";
import { freeName, stageName } from "../pure-model/names.ts";
import { chooseRecipient } from "../pure-model/recipient.ts";
import { adopt, type Owners } from "../pure-model/adopt.ts";

/**
 * Терминал — сессия: пока он открыт, агент помнит разговор, закрыли — сессия кончилась.
 *
 * Заводится он на объект (решение 0017), и объект переживает не один разговор. Поэтому имя
 * несёт номер: второй терминал того же объекта — это второй терминал, а не перезапуск первого.
 * Терминал, заведённый кнопкой этапа, принадлежит ещё и директиве — у неё он свой (решение 0032).
 *
 * Ключ при этом не имя, а идентификатор: имя меняется, пока идёт этап, и адресом служить не
 * может. Адрес объекта лежит рядом, чтобы список у объекта был его собственным, а не общим.
 */
type Session = {
  id: string;
  address: string;
  directive?: string;
  name: string;
  terminal: vscode.Terminal;
};

const sessions = new Map<string, Session>();
let counter = 0;

/**
 * Адрес MCP-сервера карты — решение 0009: расширение подставляет его в `--mcp-config` при
 * запуске агента. `--strict-mcp-config` не ставим: чужие серверы в сессии пока не мешают.
 *
 * Постоянный он или нет, решает, переживут ли терминалы перезагрузку окна (решение 0032). Порт
 * случайный — после перезагрузки агент в старом терминале стучится в пустоту, и возвращать такой
 * терминал незачем: он временный. Порт задан в `mapward.json` — терминал постоянный, и
 * расширение узнаёт его по имени вкладки.
 */
let mcpUrl: string | undefined;
let persistent = false;

/** Кто чей среди постоянных терминалов; хранилище воркспейса у редактора, не репозиторий. */
let owners: vscode.Memento | undefined;
const OWNERS_KEY = "mapward.terminals";

export function setMcpUrl(url: string | undefined, fixed = false): void {
  mcpUrl = url;
  persistent = url !== undefined && fixed;
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

function register(session: Omit<Session, "id">): Session {
  counter += 1;
  const id = `t${counter}`;
  const registered = { id, ...session };
  sessions.set(id, registered);
  return registered;
}

/** Запись «имя вкладки → чей терминал» — только живые и только в постоянном режиме. */
async function saveOwners(): Promise<void> {
  if (!persistent || !owners) return;
  const record: Owners = {};
  for (const session of living()) {
    record[session.name] = {
      address: session.address,
      ...(session.directive === undefined ? {} : { directive: session.directive }),
    };
  }
  await owners.update(OWNERS_KEY, record);
}

/**
 * Забрать терминалы карты, которые редактор вернул после перезагрузки окна. Временные он не
 * возвращает вовсе, поэтому без постоянного адреса MCP забирать нечего, и запись не читается:
 * она осталась бы от прошлого запуска с портом.
 */
export async function adoptTerminals(memento: vscode.Memento): Promise<void> {
  owners = memento;
  if (!persistent) return;

  const record = memento.get<Owners>(OWNERS_KEY) ?? {};
  const open = vscode.window.terminals;
  for (const { index, owner } of adopt(
    open.map((terminal) => terminal.name),
    record,
  )) {
    const terminal = open[index];
    if (terminal) register({ ...owner, name: terminal.name, terminal });
  }
  await saveOwners();
}

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
  /** Директива, которой терминал принадлежит; без неё он общий терминал объекта. */
  directive?: string;
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
  // Временный терминал редактор после перезагрузки окна не возвращает (решение 0032).
  const terminal = vscode.window.createTerminal({
    name,
    cwd: params.cwd,
    isTransient: !persistent,
  });
  const session = register({
    address: params.address,
    ...(params.directive === undefined ? {} : { directive: params.directive }),
    name,
    terminal,
  });
  await saveOwners();

  terminal.show(params.preserveFocus);
  // One argument, quoted the way this shell wants it — decision 0002 counts on the agent
  // reading the prompt as written, line breaks and all.
  // Флаг идёт после промпта: `--mcp-config` принимает несколько значений подряд и съедает
  // следующий позиционный аргумент — промпт уезжал бы в него вместо агента.
  const shell = shellOf(vscode.env.shell);
  terminal.sendText(`claude ${quotePrompt(params.prompt, shell)}${mcpFlag(shell)}`);
  return { id: session.id, name };
}

/** Показать уже открытый терминал, ничего в него не отправляя. */
export function showTerminal(params: { id: string }): void {
  alive(params.id)?.terminal.show();
}

export function listTerminals(params: { address: string }): { id: string; name: string }[] {
  return ofObject(params.address).map((session) => ({ id: session.id, name: session.name }));
}

export async function closeTerminal(params: { id: string }): Promise<void> {
  alive(params.id)?.terminal.dispose();
  sessions.delete(params.id);
  await saveOwners();
}

/**
 * Кому кнопка «терминал» на объекте отправляет промпт: свободный терминал этого объекта —
 * активный, иначе первый живой; иначе никто, и зовущий заводит новый (решения 0017, 0032).
 */
export function pickSession(address: string): { id: string; name: string } | undefined {
  return pickFor({ address });
}

/** Получатель кнопки этапа: терминал этой директивы и только он — решение 0032. */
export function pickStageSession(params: {
  address: string;
  directive: string;
}): { id: string; name: string } | undefined {
  return pickFor(params);
}

function pickFor(params: {
  address: string;
  directive?: string;
}): { id: string; name: string } | undefined {
  const own = ofObject(params.address);
  const id = chooseRecipient({
    ...(params.directive === undefined ? {} : { directive: params.directive }),
    own: own.map((session) => ({
      id: session.id,
      ...(session.directive === undefined ? {} : { directive: session.directive }),
      active: session.terminal === vscode.window.activeTerminal,
    })),
  });
  const chosen = own.find((session) => session.id === id);
  return chosen && { id: chosen.id, name: chosen.name };
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
    await saveOwners();
  } catch (error) {
    console.warn("mapward: терминал переименовать не удалось", error);
  }
}
