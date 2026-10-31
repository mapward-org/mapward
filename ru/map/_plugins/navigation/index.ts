import { stat } from "node:fs/promises";
import { definePlugin } from "@mapward/plugin";
import { defer } from "rxjs";
import { Type } from "typebox";

/**
 * Навигация: ссылка из метрики — куда её открыть. Кирпичи дисплея чистые и ссылку только
 * передают, а решает этот плагин — поэтому его можно поправить под проект.
 *
 * Объект карты открывает клиент: редактор о карте не знает, и `executeCommand` тут не поможет.
 * Поэтому на `mapward://` метод не открывает ничего, а отвечает, что это объект, — переходит
 * зовущий.
 */

export type Opened =
  | { kind: "object"; address: string }
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string }
  | { kind: "url"; url: string };

const SCHEME = "mapward://";

const slash = (path: string) => path.replaceAll("\\", "/");
const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);

/** Нет такого пути — не папка: пусть файл не откроется в редакторе и скажет об этом сам. */
const isFolder = (path: string) =>
  stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );

export default definePlugin({
  description: "Открыть ссылку: объект карты, файл проекта или адрес в сети",
  methods: {
    open: {
      kind: "mutation",
      description:
        "Открыть ссылку. mapward://… — объект карты: метод отвечает { kind: 'object', address }, " +
        "перейти — дело зовущего; mapward://@/… и путь (абсолютный или от корня проекта) — файл " +
        "в редакторе, папка — в проводнике редактора; http(s):// — во внешнем браузере через редактор",
      params: Type.Object({ link: Type.String(), line: Type.Optional(Type.Number()) }),
      run: (args, ctx) =>
        defer(async (): Promise<Opened> => {
          const link = args.link.trim();
          if (!link) throw new Error("ссылка пустая");

          // `mapward://@/…` — корень проекта, то есть файл, а не объект.
          if (link.startsWith(SCHEME) && !link.startsWith(`${SCHEME}@`)) {
            return { kind: "object", address: link };
          }

          const web = /^https?:\/\//i.test(link);
          if (!ctx.isVscode) {
            throw new Error(`редактора нет: открыть ${web ? "адрес" : "файл"} ${link} некому`);
          }
          if (web) {
            await ctx.vscode.executeCommand("vscode.open", link);
            return { kind: "url", url: link };
          }

          const path = link.startsWith(SCHEME)
            ? ctx.resolve(link)
            : isAbsolute(slash(link))
              ? slash(link)
              : ctx.resolve(`${SCHEME}@/${slash(link).replace(/^\.\//, "")}`);
          // Папку текстом не открыть — её показывают в проводнике, раскрытой.
          if (await isFolder(path)) {
            await ctx.vscode.reveal(path);
            return { kind: "folder", path };
          }
          await ctx.vscode.openFile(path, args.line === undefined ? {} : { line: args.line });
          return { kind: "file", path };
        }),
    },
  },
});
