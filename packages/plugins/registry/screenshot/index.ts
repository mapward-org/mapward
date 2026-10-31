import { definePlugin } from "@mapward/plugin";
import { defer } from "rxjs";
import { Type } from "typebox";
import { launchChromium } from "./browser.ts";
import { capture } from "./capture.ts";

/**
 * Скриншот метрики — как её видит человек: та же сборка клиента, что в вебвью редактора, в
 * безголовом браузере (Playwright, ставится сам при первом вызове). Агенту — проверить, что
 * компонент нарисовался, а не угадывать по коду.
 *
 * Рисует только платформа в редакторе: ей одной есть чем (`ctx.webview` — сборка вебвью и мост
 * до платформы). Тема — тёмная VS Code по умолчанию, а не тема человека.
 */
export default definePlugin({
  description: "Скриншот метрики так, как её видит человек, с консолью и ошибками страницы",
  activation: { idle: 60_000 },
  methods: {
    capture: {
      description:
        "Нарисовать метрику в безголовом браузере тем же клиентом, что вебвью, и снять PNG. " +
        "Снимок — когда заглушек загрузки не осталось и страница стихла. " +
        "viewState, expand: 'all' и params перекрывают состояние вида и параметры метрики только на этот снимок. " +
        "Ответ: path — PNG в .mapward/screenshots/ карты (откройте его, чтобы посмотреть), " +
        "console — строки консоли, errors — ошибки страницы; png строкой base64 — только с base64: true. " +
        "Первый вызов ставит Playwright и Chromium (нужна сеть)",
      params: Type.Object({
        metric: Type.String({ description: "Адрес метрики: mapward://…/_metrics/<ключ>" }),
        width: Type.Optional(Type.Number({ description: "Ширина окна, px; по умолчанию 800" })),
        height: Type.Optional(
          Type.Number({
            description: "Высота окна, px; по умолчанию 600 — снимок всё равно во всю высоту",
          }),
        ),
        base64: Type.Optional(
          Type.Boolean({ description: "Вернуть PNG ещё и строкой base64 в ответе" }),
        ),
        viewState: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), {
            description:
              "Значения useViewState по ключу на этот снимок (раскрытые папки, свёрнутость); " +
              "настройки человека не меняются",
          }),
        ),
        expand: Type.Optional(
          Type.Literal("all", { description: "всё раскрыто, ничего не свёрнуто — на этот снимок" }),
        ),
        params: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), {
            description:
              "params метрики поверх её config.json, слиянием по ключу, — на этот снимок; файлы карты не трогаются",
          }),
        ),
      }),
      result: Type.Object({
        path: Type.String(),
        png: Type.Optional(Type.String()),
        console: Type.Array(Type.String()),
        errors: Type.Array(Type.String()),
      }),
      run: (args, ctx) =>
        defer(() => capture(args, { map: ctx.map, webview: ctx.webview, launch: launchChromium })),
    },
  },
});
