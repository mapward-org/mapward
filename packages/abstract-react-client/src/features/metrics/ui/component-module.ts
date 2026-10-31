import type { JSXElementConstructor } from "react";
import { evaluateModule } from "../pure-model/evaluate.ts";

/** Пропсы у дисплея и у метрики-компонента разные: модулю всё равно, ему отдают объект. */
export type Loaded = { view?: JSXElementConstructor<object>; error?: string };

/**
 * Выполненные модули по их коду: одна и та же сборка на экране бывает в нескольких клетках, а
 * выполнять её на каждую перерисовку незачем. Код новой сборки — другая строка и другой модуль.
 */
const modules = new Map<string, Loaded>();

/** Модуль компонента получает на `require` то, что ему дали: одна копия React (решение 0037). */
export function loadModule(code: string, provided: Record<string, unknown>): Loaded {
  const known = modules.get(code);
  if (known) return known;
  let loaded: Loaded;
  try {
    const view = evaluateModule(code, provided);
    loaded =
      typeof view === "function"
        ? // Автор пишет обычную функцию: на ответы плагинов компонент подписывают сами хуки
          // набора, обёртка ему не нужна.
          { view: view as JSXElementConstructor<object> }
        : { error: "модуль не экспортирует компонент по умолчанию" };
  } catch (error) {
    loaded = { error: error instanceof Error ? error.message : String(error) };
  }
  modules.set(code, loaded);
  return loaded;
}
