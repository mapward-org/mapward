/**
 * Данные кирпичей — пункт списка и узел дерева. Так отвечают плагины (`files.tree`, скрипты
 * `shell.json`), и так их пишут компоненты карты.
 */

/** Четыре статуса со своим цветом; любой другой рисуется нейтральным, с именем в подсказке. */
export type Status = "fail" | "success" | "pending" | "idle" | (string & {});

/** Буква git у файла — как в проводнике редактора: изменён, добавлен, удалён, новый, конфликт. */
export type GitLetter = "M" | "A" | "D" | "U" | "C";

/**
 * Экшон на строке: `run` — ключ экшона объекта или полный адрес `mapward://…/_actions/<key>`,
 * `inputs` — значения его формы.
 */
export type ActionRef = { run: string; inputs?: Record<string, unknown> };

/** Пункт списка. */
export type LinkItem = {
  label?: string;
  link?: string;
  /** Вторая строка, markdown: жирный, код и ссылки. */
  description?: string;
  status?: Status;
  /** Свой цвет точки, перебивает цвет статуса. */
  color?: string;
  /** Подсказка к точке. */
  hint?: string;
  /** Пометка git: буква справа и цвет имени. */
  git?: GitLetter;
  /** Экшон строки: справа встаёт кнопка запуска, а клик по строке по-прежнему ведёт по `link`. */
  action?: ActionRef;
  /** Меню строки: открывается кнопкой «⋯» при наведении и правым кликом по строке. */
  actions?: ActionRef[];
  /**
   * Адрес объекта карты — пункт рисуется его карточкой, а не строкой: `label`, `link`, статус и
   * экшон строки у него не рисуются. `group`, `width`, `maxHeight` — как у `ObjectCard`.
   */
  object?: string;
  group?: string;
  width?: string | number;
  maxHeight?: string | number;
};

/** Узел дерева. Папка — `isDir` или узел с детьми. */
export type TreeItem = LinkItem & { isDir?: boolean; children?: TreeItem[] };

/** Пункт карточкой объекта. */
export type CardItem = LinkItem & { object: string };

export const isCard = <T extends LinkItem>(item: T): item is T & CardItem =>
  typeof item.object === "string";
