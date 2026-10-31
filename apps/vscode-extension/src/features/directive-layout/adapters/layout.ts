import * as vscode from "vscode";
import {
  directiveZone,
  isDirectivePath,
  terminalZone,
  type GroupView,
} from "../pure-model/zones.ts";

/**
 * Раскладка окна под директивы: центр — обычные файлы, справа сверху — директивы, справа снизу —
 * их терминалы. Директива и её терминал держатся вместе физически: открыл директиву — под ней
 * выбрался её терминал, выбрал терминал — над ним открылась его директива.
 *
 * Место выбирает только этот модуль, остальные спрашивают. Своего состояния о парах у него нет:
 * какой терминал чьей директивы, знает модуль терминалов, и он приходит сюда параметром —
 * так раскладка и терминалы не ссылаются друг на друга.
 */
export type Pairs = {
  terminalOf(directivePath: string): vscode.Terminal | undefined;
  directiveOf(terminal: vscode.Terminal): string | undefined;
};

/** Запомненные колонки зон: группы двигают и закрывают, поэтому это подсказка, а не истина. */
let directivesColumn: number | undefined;
let terminalsColumn: number | undefined;

const isDirectiveTab = (tab: vscode.Tab): boolean =>
  tab.input instanceof vscode.TabInputText && isDirectivePath(tab.input.uri.fsPath);

function groups(): GroupView[] {
  return vscode.window.tabGroups.all.map((group) => ({
    column: group.viewColumn,
    directives: group.tabs.some(isDirectiveTab),
    terminals: group.tabs.some((tab) => tab.input instanceof vscode.TabInputTerminal),
  }));
}

function directivesZone(): number | undefined {
  directivesColumn = directiveZone(groups(), directivesColumn);
  return directivesColumn;
}

function terminalsZone(): number | undefined {
  terminalsColumn = terminalZone(groups(), directivesZone(), terminalsColumn);
  return terminalsColumn;
}

/** Колонка правее всех: открытие туда заводит новую группу справа. */
const nextColumn = (): number =>
  Math.max(1, ...vscode.window.tabGroups.all.map((group) => group.viewColumn)) + 1;

/**
 * Открыть директиву в её зоне — справа сверху. Зоны нет — она заводится справа от всех групп.
 * Курсор уходит в директиву: её открывают, чтобы читать и отвечать.
 */
export async function openDirective(
  path: string,
  options: { preserveFocus?: boolean } = {},
): Promise<void> {
  const column = directivesZone() ?? nextColumn();
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(path), {
    viewColumn: column,
    preserveFocus: options.preserveFocus ?? false,
    preview: false,
  });
  directivesColumn = editor.viewColumn ?? column;
}

/**
 * Где завести терминал директивы — вкладкой редактора под её файлом. Группы ещё нет — она
 * заводится разрезом под группой директив, а курсор возвращается туда, где был: кнопка этапа
 * человека с места не уводит.
 */
export async function terminalLocation(
  directivePath: string,
): Promise<vscode.TerminalEditorLocationOptions> {
  const existing = terminalsZone();
  if (existing !== undefined) return { viewColumn: existing, preserveFocus: true };

  const before = vscode.window.activeTextEditor;
  await openDirective(directivePath);
  await vscode.commands.executeCommand("workbench.action.newGroupBelow");
  const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
  terminalsColumn = column;
  if (before) {
    await vscode.window.showTextDocument(before.document, {
      ...(before.viewColumn === undefined ? {} : { viewColumn: before.viewColumn }),
      preview: false,
    });
  }
  return { viewColumn: column, preserveFocus: true };
}

/**
 * Пара директива — терминал. Директиву, открытую мимо карты (из проводника, в центре), раскладка
 * переносит в свою зону, а зоны нет — заводит её.
 */
export function registerDirectiveLayout(pairs: Pairs): vscode.Disposable {
  // Сами двигаем вкладки — сами же и слышим об этом. Пока идёт перенос, на события не отвечаем.
  let moving = false;

  const onEditor = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (moving || !editor) return;
    const path = editor.document.uri.fsPath;
    if (!isDirectivePath(path)) return;

    const zone = directivesZone();
    if (editor.viewColumn !== zone) {
      moving = true;
      try {
        const stray = vscode.window.tabGroups.all
          .find((group) => group.viewColumn === editor.viewColumn)
          ?.tabs.find(
            (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === path,
          );
        await openDirective(path);
        if (stray && !stray.isDirty) await vscode.window.tabGroups.close(stray, true);
      } finally {
        moving = false;
      }
    }
    // Терминал выходит под директиву, курсор остаётся в ней.
    pairs.terminalOf(path)?.show(true);
  });

  const onTerminal = vscode.window.onDidChangeActiveTerminal(async (terminal) => {
    if (moving || !terminal) return;
    const path = pairs.directiveOf(terminal);
    if (path === undefined) return;
    const shown = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (shown === path) return;
    // Над терминалом — его директива; курсор остаётся в терминале, его выбрали.
    await openDirective(path, { preserveFocus: true });
  });

  return vscode.Disposable.from(onEditor, onTerminal);
}
