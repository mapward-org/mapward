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

/** Поле формы экшона — как `inputs` в его `config.json`. */
export type ActionField = {
  type?: "string" | "boolean" | "number" | "choice";
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  /** Варианты для `choice`. */
  options?: string[];
  multiline?: boolean;
};

/** Экшон объекта: что можно запустить отсюда — решение 0038. */
export type DisplayAction = {
  key: string;
  /** `mapward://…/_actions/<key>` */
  address: string;
  /** Подпись экшона, а без неё — ключ. */
  label: string;
  description?: string;
  /** Поля формы, после наследования и подстановок. */
  inputs: Record<string, ActionField>;
  /** Сколько прогонов идёт сейчас: прогоны одного экшона бывают параллельными. */
  running: number;
};

/**
 * Экшон на строке: `run` — ключ экшона объекта или полный адрес `mapward://…/_actions/<key>`,
 * `inputs` — значения его формы. В JSON-схеме данных — `{ "$ref": "mapward:action" }`.
 */
export type ActionRef = { run: string; inputs?: Record<string, unknown> };

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
  /** Экшоны объекта — решение 0038. */
  actions: DisplayAction[];
  /**
   * Запустить экшон так же, как кнопкой в шапке: всё заполнено и подтверждения не просили —
   * сразу, иначе откроется форма с `inputs`. `action` — ключ или полный адрес.
   */
  run: (action: string, inputs?: Record<string, unknown>) => void;
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
  /** Экшон строки: справа встаёт кнопка запуска, а клик по строке по-прежнему ведёт по `link`. */
  action?: ActionRef;
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

/**
 * Кнопка экшона — та же, что ставит в клетку раскладка. `action` — ключ или адрес, `inputs` —
 * значения формы, `label` — своя подпись вместо подписи экшона.
 */
export declare function ActionButton(props: {
  action: string;
  inputs?: Record<string, unknown>;
  label?: string;
}): ReactElement;
