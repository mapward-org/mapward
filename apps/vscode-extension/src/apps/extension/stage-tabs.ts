import { renameForStage } from "@/features/terminals/index.extension.ts";
import type { MapServer } from "@mapward/abstract-server";

/**
 * Какой этап какой директивы расширение отправило в какую сессию. Знание живёт здесь, потому
 * что отправляла его кнопка: сервер о прогоне знает, но не знает, кто позвал, — решение 0017.
 *
 * Отсюда и граница: запуск словами вкладку не трогает. Связывать сессию с прогоном придётся,
 * когда понадобятся уведомления.
 */
type Running = { address: string; directive: string; stage: string; base: string };

const running = new Map<string, Running>();

export function rememberStage(id: string, what: Running): void {
  running.set(id, what);
}

/**
 * Сервер в окне один и отдан и мосту, и MCP. Поэтому конец этапа ловится обёрткой вокруг него:
 * откуда бы он ни пришёл — из кнопки или из слов в терминале, — вкладка узнает об этом, если
 * этап запускали кнопкой.
 *
 * Переименование вкладки платформенное, серверу ему не место (решения 0014, 0015).
 */
export function withStageTabs(server: MapServer): MapServer {
  return {
    ...server,
    finishDirective: async (params) => {
      const result = await server.finishDirective(params);
      // Адрес в сравнении обязателен: имя файла директивы у разных объектов совпадает, и без
      // него отметка о конце уехала бы в чужую вкладку.
      const entry = [...running.entries()].find(
        ([, what]) =>
          what.address === params.address &&
          what.directive === params.directive &&
          what.stage === result.stage,
      );
      if (entry) {
        const [id, what] = entry;
        running.delete(id);
        await renameForStage({
          id,
          base: what.base,
          directive: what.directive,
          stage: what.stage,
          done: true,
        });
      }
      return result;
    },
  };
}
