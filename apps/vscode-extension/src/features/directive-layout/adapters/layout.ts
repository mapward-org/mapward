import * as vscode from "vscode";
import {
  centerZone,
  directiveZone,
  isDirectivePath,
  newDirectiveColumn,
  terminalZone,
  type GroupView,
} from "../pure-model/zones.ts";

/**
 * Раскладка окна под директивы: центр — обычные файлы, справа сверху — директивы, справа снизу —
 * их терминалы. Директива и её терминал держатся вместе физически: открыл директиву — под ней
 * выбрался её терминал, выбрал терминал — над ним открылась его директива.
 *
 * Обе правые группы раскладка заводит сама и закрепляет: в закреплённую группу VS Code чужой файл
 * не кладёт, и группа остаётся узнаваемой по содержимому.
 *
 * Место выбирает только этот модуль, остальные спрашивают. Своего состояния о парах у него нет:
 * какой терминал чьей директивы, знает модуль терминалов, и он приходит сюда параметром —
 * так раскладка и терминалы не ссылаются друг на друга.
 */
export type Pairs = {
  terminalOf(directivePath: string): vscode.Terminal | undefined;
  directiveOf(terminal: vscode.Terminal): string | undefined;
  /** Завести терминал директивы, у которой его нет: открыл директиву — рядом её агент. */
  open(directivePath: string): Promise<void>;
  /** Вкладок директивы не осталось — закрыть её терминал; разговор при этом сохраняется. */
  close(directivePath: string): Promise<void>;
};

/**
 * Запомненные колонки зон. Номер колонки VS Code пересчитывает при любой перестройке групп, поэтому
 * зона узнаётся по содержимому, а номер — подсказка, какую из подходящих взять.
 */
let directivesColumn: number | undefined;
let terminalsColumn: number | undefined;

/**
 * Перестройки раскладки идут по одной. Закрепление работает по активной группе, а не по названной:
 * пока одна перестройка заводит группу и закрепляет её, вторая успела бы увести фокус, и
 * закрепилась бы чужая группа.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}

/** Закрепить активную группу: команда не переключатель, повтор безвреден. */
const lockActiveGroup = () => vscode.commands.executeCommand("workbench.action.lockEditorGroup");

const isDirectiveTab = (tab: vscode.Tab): boolean =>
  tab.input instanceof vscode.TabInputText &&
  tab.input.uri.scheme === "file" &&
  isDirectivePath(tab.input.uri.fsPath);

const isTerminalTab = (tab: vscode.Tab): boolean => tab.input instanceof vscode.TabInputTerminal;

const samePath = (a: string, b: string) =>
  a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase();

/** Открыта ли директива ещё хоть где-нибудь — в любой группе. */
const stillOpen = (path: string): boolean =>
  vscode.window.tabGroups.all.some((group) =>
    group.tabs.some(
      (tab) => tab.input instanceof vscode.TabInputText && samePath(tab.input.uri.fsPath, path),
    ),
  );

/** Вкладки директивы вне её группы — копии, открытые мимо раскладки. */
const strays = (path: string, zone: number | undefined): vscode.Tab[] =>
  vscode.window.tabGroups.all
    .filter((group) => group.viewColumn !== zone)
    .flatMap((group) => group.tabs)
    .filter(
      (tab) => tab.input instanceof vscode.TabInputText && samePath(tab.input.uri.fsPath, path),
    );

function groups(): GroupView[] {
  return vscode.window.tabGroups.all.map((group) => ({
    column: group.viewColumn,
    directives: group.tabs.some(isDirectiveTab),
    terminals: group.tabs.some(isTerminalTab),
    others: group.tabs.some((tab) => !isDirectiveTab(tab) && !isTerminalTab(tab)),
  }));
}

function directivesZone(): number | undefined {
  directivesColumn = directiveZone(groups(), directivesColumn);
  return directivesColumn;
}

function terminalsZone(): number | undefined {
  terminalsColumn = terminalZone(groups(), terminalsColumn);
  return terminalsColumn;
}

/**
 * Директива в своей группе. Группы нет — она заводится справа от всего открытого и закрепляется.
 * Курсор уходит в директиву: её открывают, чтобы читать и отвечать; раз фокус там — группа
 * закрепляется и тогда, когда она уже была, на случай если её завели раньше без закрепления.
 */
async function showDirective(path: string, preserveFocus: boolean): Promise<void> {
  const zone = directivesZone();
  const column = zone ?? newDirectiveColumn(groups());
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(path), {
    viewColumn: column,
    // Новую группу закрепить можно, только встав в неё.
    preserveFocus: zone !== undefined && preserveFocus,
    preview: false,
  });
  directivesColumn = editor.viewColumn ?? column;
  if (zone === undefined || !preserveFocus) await lockActiveGroup();
}

/** Открыть директиву в её группе — справа сверху. */
export function openDirective(
  path: string,
  options: { preserveFocus?: boolean } = {},
): Promise<void> {
  return serial(() => showDirective(path, options.preserveFocus ?? false));
}

/**
 * Завести центр, когда его нет — все группы заняты директивами и терминалами: колонка слева на
 * всю высоту окна, а директива с терминалом — правой колонкой друг над другом.
 *
 * Разрез группы делит только её клетку, поэтому новая группа ставится первой (над первой группой),
 * а затем окну задаётся раскладка: VS Code раздаёт клеткам существующие группы по порядку на
 * экране, так что первая — центр — встаёт слева, остальные — справа, со своими вкладками.
 */
async function makeCenter(): Promise<number> {
  await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
  await vscode.commands.executeCommand("workbench.action.newGroupAbove");
  const right = vscode.window.tabGroups.all.length - 1;
  await vscode.commands.executeCommand("vscode.setEditorLayout", {
    orientation: 0,
    groups: [{ size: 0.6 }, { size: 0.4, groups: Array.from({ length: right }, () => ({})) }],
  });
  return 1;
}

/**
 * Открыть обычный файл в центре, а не в активной группе: активной часто бывает группа директив,
 * а закреплённую VS Code обходит и уводит файл к соседям — к терминалам.
 */
export async function openFile(path: string): Promise<void> {
  const column = await serial(async () => {
    const directives = directivesZone();
    return centerZone(groups(), directives, terminalsZone()) ?? (await makeCenter());
  });
  await vscode.window.showTextDocument(vscode.Uri.file(path), { viewColumn: column });
}

/**
 * Где завести терминал директивы — вкладкой редактора под её файлом. Группы ещё нет — она
 * заводится разрезом под группой директив и закрепляется, а курсор возвращается туда, где был:
 * кнопка этапа человека с места не уводит.
 */
export function terminalLocation(
  directivePath: string,
): Promise<vscode.TerminalEditorLocationOptions> {
  return serial(async () => {
    const existing = terminalsZone();
    if (existing !== undefined) return { viewColumn: existing, preserveFocus: true };

    const before = vscode.window.activeTextEditor;
    await showDirective(directivePath, false);
    await vscode.commands.executeCommand("workbench.action.newGroupBelow");
    await lockActiveGroup();
    const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
    terminalsColumn = column;
    if (before) {
      await vscode.window.showTextDocument(before.document, {
        ...(before.viewColumn === undefined ? {} : { viewColumn: before.viewColumn }),
        preview: false,
      });
    }
    return { viewColumn: column, preserveFocus: true };
  });
}

/**
 * Пара директива — терминал. Директиву, открытую мимо карты (из проводника, в центре), раскладка
 * переносит в свою группу, а группы нет — заводит её.
 */
export function registerDirectiveLayout(pairs: Pairs): vscode.Disposable {
  // Сами двигаем вкладки — сами же и слышим об этом. Пока идёт перенос, на события не отвечаем.
  let moving = false;

  const onEditor = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (moving || !editor) return;
    // Директива в диффе или из истории git — не та директива, которую открыли работать.
    if (editor.document.uri.scheme !== "file") return;
    const path = editor.document.uri.fsPath;
    if (!isDirectivePath(path)) return;

    // Обработчик ждёт своей очереди, и колонка из события к тому времени могла съехать: копии
    // директивы ищутся по пути во всех группах, кроме своей.
    await serial(async () => {
      const zone = directivesZone();
      if (zone !== undefined && strays(path, zone).length === 0) {
        // Директива уже в своей группе, и фокус в ней — закрепить, если группа досталась
        // незакреплённой: например, директиву открыли из проводника в пустом окне.
        if (vscode.window.tabGroups.activeTabGroup.viewColumn === zone) await lockActiveGroup();
        return;
      }
      moving = true;
      try {
        await showDirective(path, false);
        const copies = strays(path, directivesColumn).filter((tab) => !tab.isDirty);
        if (copies.length > 0) await vscode.window.tabGroups.close(copies, true);
      } finally {
        moving = false;
      }
    });

    // Терминал выходит под директиву, курсор остаётся в ней. Терминала нет — заводится: при
    // любом открытии директивы рядом её агент, с прежним разговором, если он был.
    const terminal = pairs.terminalOf(path);
    if (terminal) terminal.show(true);
    else await pairs.open(path);
  });

  // Закрыли директиву — закрылся и её терминал. Перенос в свою группу закрывает копию, а не
  // директиву: она открыта в группе, и терминал остаётся.
  const onTabs = vscode.window.tabGroups.onDidChangeTabs(async (event) => {
    for (const tab of event.closed) {
      if (!isDirectiveTab(tab) || !(tab.input instanceof vscode.TabInputText)) continue;
      const path = tab.input.uri.fsPath;
      // oxlint-disable-next-line no-await-in-loop
      if (!stillOpen(path)) await pairs.close(path);
    }
  });

  const onTerminal = vscode.window.onDidChangeActiveTerminal(async (terminal) => {
    if (moving || !terminal) return;
    const path = pairs.directiveOf(terminal);
    if (path === undefined) return;
    const shown = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (shown !== undefined && samePath(shown, path)) return;
    // Над терминалом — его директива; курсор остаётся в терминале, его выбрали.
    await openDirective(path, { preserveFocus: true });
  });

  return vscode.Disposable.from(onEditor, onTerminal, onTabs);
}
