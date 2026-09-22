import * as vscode from "vscode";
import type { LocatedDirective } from "../pure-model/locate.ts";

/**
 * Кнопки этапов прямо в файле директивы — решение 0032: дописал ответ в треде и запустил
 * следующий круг, не уходя на карту. Кнопка ничего не выполняет сама (0017): она зовёт тот же
 * запуск этапа, что и ряд на карте.
 *
 * Как файл узнаёт себя в карте и как этап запускается, фиче передают снаружи: сводить сервер
 * карты и терминалы — работа слоя сборки, а не её.
 */
export type DirectiveButtons = {
  locate: (uri: vscode.Uri) => Promise<LocatedDirective | undefined>;
  run: (target: { uri: vscode.Uri; located: LocatedDirective; stage: string }) => Promise<void>;
};

const RUN = "mapward.directive.runStage";
const PICK = "mapward.directive.pickStage";

export function registerDirectiveButtons(buttons: DirectiveButtons): vscode.Disposable {
  /**
   * Агент читает директиву с диска: несохранённый ответ он бы не увидел и ответил на
   * прошлую реплику.
   */
  const run = async (uri: vscode.Uri, stage: string) => {
    const document = vscode.workspace.textDocuments.find(
      (open) => open.uri.toString() === uri.toString(),
    );
    if (document?.isDirty) await document.save();
    const located = await buttons.locate(uri);
    if (!located) return;
    try {
      await buttons.run({ uri, located, stage });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `mapward: этап не запустился — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // Строка ссылок стоит под последней строкой файла: тред дописывается снизу, и кнопка
  // оказывается прямо под ответом, который только что написан.
  const lenses: vscode.CodeLensProvider = {
    provideCodeLenses: async (document) => {
      const located = await buttons.locate(document.uri);
      if (!located) return [];
      const last = document.lineAt(document.lineCount - 1).range;
      return located.stages.map(
        (stage) =>
          new vscode.CodeLens(last, {
            title: `▶ ${stage.name}`,
            command: RUN,
            arguments: [document.uri, stage.name],
          }),
      );
    },
  };

  return vscode.Disposable.from(
    vscode.languages.registerCodeLensProvider(
      { language: "markdown", scheme: "file", pattern: "**/_directives/*.md" },
      lenses,
    ),
    vscode.commands.registerCommand(RUN, (uri: vscode.Uri, stage: string) => run(uri, stage)),

    // В заголовке вкладки нельзя поставить переменное число кнопок, поэтому там одна, и этапы
    // выбираются списком.
    vscode.commands.registerCommand(PICK, async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return;
      const located = await buttons.locate(target);
      if (!located) {
        void vscode.window.showInformationMessage("mapward: этот файл не директива ни одной карты");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        located.stages.map((stage) => stage.name),
        { title: `Этап директивы ${located.directive}` },
      );
      if (picked) await run(target, picked);
    }),
  );
}
