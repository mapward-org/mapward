import { EMPTY } from "rxjs";
import { useMutation, usePlugin, useStream } from "@mapward/component";
import type { PluginStream } from "@mapward/component";

/**
 * Откуда вид берёт данные: метод плагина, который даёт их потоком, или статика в `data`.
 *
 * `plugin` — абсолютный путь, обычно подстановкой: `${{ mapward:// }}/_plugins/files`. Так один
 * текст годится и сюда, и в `agent` метрики, где путь от `config.json` иначе считался бы от другой
 * папки, и метрика прототипа находит плагин у любого наследника.
 */
export type Source = { plugin: string; method: string; params?: unknown };

/** Общие параметры видов. */
export type ViewParams = {
  source?: Source;
  /** Статика вместо источника — то, что раньше было коллектором `static`. */
  data?: unknown;
  /** Что сказать, когда показывать нечего: пустота — это ответ, а не ошибка. */
  empty?: string;
  /**
   * Изменяющий метод источника для кнопки «обновить» — с теми же параметрами (`refresh` у
   * `agent.ask`). Не назван — кнопка переподписывается на источник: команда `shell.json`
   * выполнится заново.
   */
  refresh?: string;
  /** Метрика приходит свёрнутой; свёрнутое руками помнится у человека и перекрывает это. */
  collapsed?: boolean;
};

/**
 * Значение с собственным временем — так отвечает `agent.ask`: `asked` — спрашивали ли, `data` —
 * ответ, `busy` — идёт новый вопрос. Остальные источники отдают данные как есть.
 */
type Asked = { asked: boolean; updatedAt?: string; data?: unknown; busy?: boolean };

const isAsked = (value: unknown): value is Asked =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { asked?: unknown }).asked === "boolean";

/** Без источника звать некого: поток, который сразу кончился, — хук не бывает условным. */
const nothing: PluginStream<unknown> = EMPTY;

export type SourceState = {
  /** Первого значения ещё нет. */
  loading: boolean;
  /** Есть ли что показать: у `agent.ask` — спрашивали ли агента. */
  answered: boolean;
  data: unknown;
  updatedAt?: string | undefined;
  busy: boolean;
  error?: string | undefined;
  refresh: () => void;
};

/** Данные вида потоком, пока он на экране, и кнопка обновления к ним. */
export function useSource(params: ViewParams): SourceState {
  const source = params.source;
  // Хук не бывает условным: без источника клиент плагина просто не зовётся.
  const plugin = usePlugin(source?.plugin ?? ".");
  // Ключ — сам источник: вид, вернувшийся на экран, начинает с прошлого ответа, а не с пустоты.
  const stream = useStream<unknown>(
    source ? [source.plugin, source.method, source.params ?? {}] : "views:static",
    () => (source ? plugin[source.method]!(source.params ?? {}) : nothing),
  );
  const mutation = useMutation((args: unknown) => plugin[params.refresh ?? "refresh"]!(args));

  // Статика — сразу, с первого кадра: ждать её неоткуда.
  if (!source) {
    return {
      loading: false,
      answered: params.data !== undefined,
      data: params.data,
      busy: false,
      refresh: () => {},
    };
  }
  const last = stream.last;
  const asked = isAsked(last) ? last : undefined;
  return {
    loading: last === undefined && stream.status !== "error",
    answered: asked ? asked.asked : last !== undefined,
    data: asked ? asked.data : last,
    updatedAt: asked?.updatedAt,
    busy: asked?.busy === true || mutation.status === "running",
    error: stream.error ?? mutation.error,
    refresh: () => (params.refresh ? mutation.run(source.params ?? {}) : stream.refetch()),
  };
}
