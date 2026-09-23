/**
 * @mapward/display — типы дисплея-компонента метрики (решение 0037).
 *
 * Кода здесь нет: на карте `import … from "@mapward/display"` подменяет клиент, и компонент
 * получает те же кусочки, которыми нарисована сама карта. Пакет ставят в проект dev-зависимостью
 * ради типов — чтобы компонент проверялся `mapward display check`, а не угадывался.
 *
 * ```tsx
 * import type { DisplayProps } from "@mapward/display";
 * import { List } from "@mapward/display";
 * import type { Data } from "./display.data";
 *
 * export default function Display({ data }: DisplayProps<Data>) {
 *   return <List items={data.items} />;
 * }
 * ```
 */

import type { ReactElement } from "react";

/** Объект карты, на котором висит метрика. */
export type DisplayObject = {
  /** `mapward://…` */
  address: string;
  name: string;
  /** Папка объекта на диске. */
  path: string;
  /** `props` после наследования и подстановок. */
  props: Record<string, unknown>;
};

/** Сама метрика: что она и когда собрана. */
export type DisplayMetric = {
  key: string;
  /** `mapward://…/_metrics/<key>` */
  address: string;
  /** Подпись метрики, а без неё — ключ. */
  label: string;
  /** Когда получено значение, ISO. */
  updatedAt?: string;
  /** Чем кончился последний прогон. */
  ok?: boolean;
  /** Идёт ли прогон сейчас. */
  busy: boolean;
};

/**
 * Пропсы компонента. `Data` — тип данных по схеме метрики: его пишет рядом с компонентом
 * `mapward display check` файлом `display.data.d.ts`.
 */
export type DisplayProps<Data = unknown> = {
  /** Значение метрики, уже проверенное её схемой. */
  data: Data;
  object: DisplayObject;
  metric: DisplayMetric;
  /**
   * Открыть ссылку так же, как любая ссылка карты: путь к файлу — в редакторе, `mapward://` —
   * объект, `http(s)://` — страницу.
   */
  open: (link: string) => void;
};

/** Четыре статуса со своим цветом; любой другой рисуется нейтральным, с именем в подсказке. */
export type Status = "fail" | "success" | "pending" | "idle" | (string & {});

/** Пункт: то же, что у готового дисплея `list`. */
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
};

/** Узел дерева: то же, что у готового дисплея `tree`. */
export type TreeItem = LinkItem & { isDir?: boolean; children?: TreeItem[] };

/** Ссылка с точкой статуса — как пункт списка карты. */
export declare function Link(props: { item: LinkItem }): ReactElement;

/** Markdown карты: заголовки, списки, код, ссылки. `inline` — одной строкой, без абзацев. */
export declare function Markdown(props: { text: string; inline?: boolean }): ReactElement;

/** Точка статуса. */
export declare function StatusDot(props: {
  status?: Status;
  color?: string;
  hint?: string;
}): ReactElement;

/** Список пунктов — готовый дисплей `list`. `empty` — что сказать, когда пунктов нет. */
export declare function List(props: { items: LinkItem[]; empty?: string }): ReactElement;

/** Файловое дерево — готовый дисплей `tree`. */
export declare function FileTree(props: { items: TreeItem[] }): ReactElement;
