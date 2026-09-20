import * as vscode from "vscode";

/**
 * Документы, которых нет на диске. Мердженный конфиг метрики собран из нескольких файлов и не
 * лежит ни в одном — а смотрят его ради глоб, команд и подстановок, то есть ради всего текста
 * (решение 0019). Временный файл для этого не годится: он просит имя, папку и уборку, а при
 * закрытии предлагает сохранить то, чего на диске нет.
 */
const SCHEME = "mapward";

/** Показанное живёт до конца сессии: провайдер зовут и после открытия, при каждом перерисовывании. */
const shown = new Map<string, string>();
const changed = new vscode.EventEmitter<vscode.Uri>();

const provider: vscode.TextDocumentContentProvider = {
  onDidChange: changed.event,
  provideTextDocumentContent: (uri) => shown.get(uri.toString()) ?? "",
};

/** Регистрируется на всё время жизни расширения: документ могут открыть из любой карты. */
export function registerVirtualDocs(): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider);
}

/**
 * Заголовок становится путём: по нему же документ и узнаётся, поэтому повторный показ того же
 * заголовка обновляет вкладку, а не открывает вторую.
 */
export async function openVirtual(params: {
  title: string;
  text: string;
  language: string;
}): Promise<void> {
  const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${params.title}` });
  shown.set(uri.toString(), params.text);
  changed.fire(uri);

  const document = await vscode.workspace.openTextDocument(uri);
  // Подсветка включается языком, а не расширением: расширения у такого документа нет.
  await vscode.languages.setTextDocumentLanguage(document, params.language);
  await vscode.window.showTextDocument(document, { preview: true });
}
