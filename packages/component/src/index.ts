/**
 * @mapward/component — API окна для метрики-компонента (решение 0037): то, чем компонент говорит
 * с платформой, — плагины, навигация, состояние вида, экшоны, карточка объекта — и типы пропсов.
 *
 * Кода здесь нет: на карте `import … from "@mapward/component"` подменяет клиент. Пакет ставят в
 * проект dev-зависимостью ради типов — чтобы компонент проверялся компилятором, а не угадывался.
 *
 * Готовых кирпичей (список, дерево, markdown, сетка) здесь нет: они — код встроенного плагина
 * `views` (`_plugins/views/bricks/`), его копия в карте, и берутся относительным импортом.
 *
 * ```tsx
 * import type { MetricProps } from "@mapward/component";
 * import { useNavigation, usePlugin, useStream } from "@mapward/component";
 * import { List } from "../../_plugins/views/bricks/list.tsx";
 * import type shell from "../../_plugins/shell/index.ts";
 *
 * export default function Runs({ params }: MetricProps<{ command: string }>) {
 *   const plugin = usePlugin<typeof shell>("../../_plugins/shell");
 *   const runs = useStream(["shell.json", params.command], () =>
 *     plugin.json({ command: params.command }),
 *   );
 *   return <List items={(runs.last as { items?: [] })?.items ?? []} onClick={useNavigation()} />;
 * }
 * ```
 */

import type { ReactElement, ReactNode } from "react";
import type { Observable } from "rxjs";

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

/**
 * Пропсы своей формы экшона — компонента из поля `component` его `config.json`. Форма открывается
 * всегда, даже когда всё заполнено; рамку, заголовок и ошибки сервера рисует карта, поля и кнопки
 * — компонент. `submit` уходит тем же путём, что обычная форма: вопрос `confirm`, если он есть,
 * и запуск; ошибки полей возвращаются в `errors`, форма остаётся открытой.
 *
 * ```tsx
 * import type { ActionFormProps } from "@mapward/component";
 *
 * export default function Form({ params, submit, sending }: ActionFormProps<{ title?: string }>) {
 *   return <button disabled={sending} onClick={() => submit({ title: params.title ?? "новое" })}>Создать</button>;
 * }
 * ```
 */
export type ActionFormProps<Params = Record<string, unknown>> = {
  /** Значения на старте: переданные запуском и умолчания полей. */
  params: Params;
  /** JSON-схема параметров метода из самоописания плагина; у экшона с `inputs` её нет. */
  schema: unknown;
  /** Поля формы, какими их нарисовала бы обычная форма: `inputs` или схема метода. */
  fields: Record<string, ActionField>;
  /** Ошибки сервера по полям после неудачной отправки. */
  errors: Record<string, string>;
  /** Отправлено, ждём ответа «принято». */
  sending: boolean;
  action: { key: string; address: string; label: string; description?: string };
  submit: (values: Record<string, unknown>) => void;
  cancel: () => void;
};

/**
 * Пропсы метрики-компонента: у неё нет значения от платформы — данные она берёт у плагинов сама.
 * `Params` — её `params` из `config.json`, уже после подстановок.
 */
export type MetricProps<Params = Record<string, unknown>> = {
  params: Params;
  object: DisplayObject;
  metric: { key: string; address: string; label: string };
  /**
   * Метрика стоит в превью объекта — на карточке чужого экрана: места мало, шапка лишняя.
   * Признак места показа, а не метрики; что убрать, решает компонент.
   */
  compact?: boolean;
  /** Открыть метрику отдельным табом. Нет — хост без табов или метрика уже в своём табе. */
  openTab?: () => void;
};

/**
 * Поток значений метода плагина — `Observable` из rxjs. Сам rxjs компоненту даёт карта, как
 * `react`: `import { map } from "rxjs"` берёт ту же копию, ставить его не нужно.
 */
export type PluginStream<T> = Observable<T>;

type StreamValue<R> = R extends Observable<infer V> ? V : unknown;

/**
 * Методы плагина на клиенте: каждый — функция от аргументов, отдающая поток. Типы берутся из
 * самого плагина: `usePlugin<typeof plugin>(…)`, где `plugin` — его `definePlugin`.
 */
export type PluginApi<P> = P extends {
  methods: infer M extends Record<string, { run: (...args: never[]) => unknown }>;
}
  ? {
      [K in keyof M]: (
        args?: Parameters<M[K]["run"]>[0],
      ) => PluginStream<StreamValue<ReturnType<M[K]["run"]>>>;
    }
  : Record<string, (args?: unknown) => PluginStream<unknown>>;

/**
 * Клиент плагина. Путь — от файла компонента или абсолютный. Вызов идёт через платформу в процесс
 * плагина; что вызвать и когда, решают хуки ниже.
 */
export declare function usePlugin<P = unknown>(path: string): PluginApi<P>;

/**
 * Ключ запроса — как `queryKey` в react-query: строка или массив из JSON, сравнивается по
 * содержимому. Ключ — это и зависимости (поменялся — новый запрос), и место в памяти карты:
 * вернувшийся компонент (смена вкладки, переход назад) с тем же ключом начинает с прошлого
 * ответа, а не с пустоты, пока плагин отвечает заново. Начинайте ключ с плагина и метода —
 * `["files.tree", path]`: одинаковый ключ у разных запросов покажет на миг чужое.
 */
export type QueryKey = string | readonly unknown[];

/**
 * Запрос: подписка на поток, пока компонент на экране. `data` — последнее значение; ошибка его не
 * стирает — прошлое значение честнее пустоты. Пока плагин не ответил, `status` — `loading`, а
 * `data` — прошлый ответ того же ключа, если он был.
 *
 * ```tsx
 * const runs = useQuery(["shell.json", params.command], () => shell.json({ command: params.command }));
 * ```
 */
export declare function useQuery<T>(
  key: QueryKey,
  query: () => Observable<T>,
): {
  status: "loading" | "success" | "error";
  data: T | undefined;
  error: string | undefined;
  refetch: () => void;
};

/**
 * Поток: каждое значение, пока компонент на экране. `done` — поток кончился сам. Пока плагин не
 * ответил, `status` — `connecting`, а `last` — прошлое значение того же ключа, если оно было.
 * `refetch` — подписаться заново (команда `shell.json` выполнится ещё раз), `last` остаётся.
 */
export declare function useStream<T>(
  key: QueryKey,
  stream: () => Observable<T>,
): {
  status: "connecting" | "open" | "done" | "error";
  last: T | undefined;
  error: string | undefined;
  refetch: () => void;
};

/** Изменение по вызову: клик, форма. `run` запускает, размонтирование отменяет идущее. */
export declare function useMutation<A, T>(
  mutate: (args: A) => Observable<T>,
): {
  status: "idle" | "running" | "success" | "error";
  data: T | undefined;
  error: string | undefined;
  run: (args: A) => void;
};

/**
 * Как открыть: `tab` — ctrl + клик по ссылке на объект, отдельным табом. Хост без табов открывает
 * такую ссылку обычным переходом.
 */
export type OpenHow = { tab?: boolean };

/**
 * Открыть ссылку так же, как любая ссылка карты: ссылку или пункт с `link` (пункт без ссылки —
 * ничего). Подходит прямо в `onClick` кирпичей `views`: `<List items={…} onClick={navigate} />`.
 */
export type Navigate = (target: string | { link?: string | undefined }, how?: OpenHow) => void;

/**
 * Навигация карты — встроенный плагин `navigation` (`_plugins/navigation` карты): он решает, куда
 * ведёт ссылка, — файл в редакторе, страница в браузере; на объект карты он отвечает «это объект»,
 * и переходит к нему сам экран. Кирпичи ничего не открывают сами: что делать по клику, говорит
 * компонент, а этот хук — то, что ему обычно нужно.
 */
export declare function useNavigation(): Navigate;

/**
 * Куда рисовать порталом то, что ложится поверх карты: меню, подсказки, окна. Css компонента
 * действует только на его территории — в его клетке и в этом слое; вынесенное прямо в
 * `document.body` останется без его классов. Отдаёт функцию: слой заводится, когда его просят.
 *
 * ```tsx
 * const floating = useFloatingLayer();
 * return open && createPortal(<div className="fixed z-50 …">…</div>, floating());
 * ```
 */
export declare function useFloatingLayer(): () => HTMLElement;

/**
 * Настройка смотрящего — масштаб холста, свёрнутая панель, последний выбор: хранит её хост, у
 * человека, а не в карте, и она переживает перезагрузку окна. Ключ общий на все компоненты —
 * своё различайте префиксом. Пока хранилище не ответило, значение — `initial`. На странице
 * снимка (`screenshot`) значения можно перекрыть, а запись остаётся в памяти страницы.
 */
export declare function useViewState<T>(
  key: string,
  initial: T,
  options?: {
    /**
     * Каким ключ бывает, когда раскрыто всё. Его отдаёт снимок метрики (`screenshot.capture` с
     * `expand: "all"`): дерево — все папки открыты, рамка — не свёрнута. Не назван — снимок
     * берёт значение человека.
     */
    expanded?: T;
  },
): [T, (value: T) => void];

/**
 * Экшон, каким его видит компонент. `label` и `description` — экшона, а пока его нет — сама
 * ссылка подписью.
 */
export type ActionHandle = {
  /**
   * Запуск тем же путём, что из шапки объекта: форма, если нужна, вопрос `confirm`, история
   * прогонов. `inputs` ложатся поверх тех, что даны хуку.
   */
  run: (inputs?: Record<string, unknown>) => void;
  /** Сколько прогонов идёт: прогоны одного экшона бывают параллельными. */
  running: number;
  label: string;
  description: string | undefined;
  /**
   * Экшона по ссылке нет. Пока объект-владелец экшона, названного адресом, не пришёл с сервера,
   * это «ещё не знаем», а не «нет»: `missing` — `false`.
   */
  missing: boolean;
};

/**
 * Экшон карты — решение 0038: ключ экшона своего объекта или полный адрес
 * `mapward://…/_actions/<ключ>`. `inputs` — значения его формы.
 *
 * ```tsx
 * const deploy = useAction("deploy", { env: "stage" });
 * <button disabled={deploy.missing} onClick={() => deploy.run()}>{deploy.label}</button>
 * ```
 */
export declare function useAction(action: string, inputs?: Record<string, unknown>): ActionHandle;

/**
 * Карточка объекта — та же, что у пункта списка с `object`: имя со ссылкой, кнопки объекта и
 * компактная сетка метрик его превью. `group` — группа метрик превью вместо `defaultPreview`;
 * `width` и `maxHeight` — числом в пикселях или строкой css. `actions` — свои кнопки в шапке,
 * перед кнопками объекта; `draggable` — ручка в шапке с классом `mw-card-drag`, за которую
 * карточку тащит холст.
 */
export declare function ObjectCard(props: {
  object: string;
  group?: string;
  width?: string | number;
  maxHeight?: string | number;
  actions?: ReactNode;
  draggable?: boolean;
}): ReactElement;

/**
 * Метрика группы, как её получает раскладка. `node` — уже нарисованная метрика: её компонент
 * в своей клетке, рамку рисует он сам. Подписка метрики живёт, пока её `node` смонтирован: что
 * раскладка не поставила, то и не собирается.
 */
export type LayoutMetric = {
  key: string;
  /** Подпись метрики, а без неё — ключ. */
  label: string;
  node: ReactNode;
};

/**
 * Пропсы раскладки группы — компонента из поля `layout` группы в `_index.json`. Метрики группы
 * приходят дважды: по ключу — ставить по местам, и списком в порядке `metrics` группы — идти
 * подряд.
 *
 * ```tsx
 * import type { LayoutProps } from "@mapward/component";
 * import { Grid } from "./_plugins/views/bricks/grid.tsx";
 *
 * export default function Layout({ metrics }: LayoutProps) {
 *   return <Grid areas={[["code", "docs"], ["files", "files"]]}>{metrics}</Grid>;
 * }
 * ```
 */
export type LayoutProps = {
  metrics: Record<string, LayoutMetric>;
  list: LayoutMetric[];
  object: DisplayObject;
  group: { key: string; label: string };
};
