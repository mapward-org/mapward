import type { ReactNode } from "react";
import { useNavigation, useViewState } from "@mapward/component";
import type { MetricProps } from "@mapward/component";
import { Display } from "./bricks/display.tsx";
import { useSource, type ViewParams } from "./source.ts";

/**
 * Рамка вида: подпись, время ответа, «загружается», ошибка, кнопка обновления и сворачивание.
 * Что внутри, рисует кирпич `Display` из `bricks/` по виду; данные приводит к его форме сам вид
 * (`shape`).
 */

/** Сколько минут значение может стареть молча: свежая метрика о времени не говорит ничего. */
const STALE_AFTER_MINUTES = 10;

/** «25 мин назад», а не отметка времени: глазу нужна свежесть. */
function ago(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < STALE_AFTER_MINUTES) return undefined;
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} д назад`;
}

const MUTED = "text-[var(--mw-descriptionForeground)]";
const FAILED = { color: "var(--mw-testing-iconFailed, #f85149)" };

export function View(
  props: MetricProps<ViewParams> & {
    kind: string;
    /** Данные источника — в форму кирпича: список, дерево и текст бывают голыми. */
    shape?: (data: unknown) => unknown;
  },
): ReactNode {
  const { params, object, metric, compact } = props;
  const source = useSource(params);
  const navigate = useNavigation();
  // Свёрнутость — у человека, своя на объект и метрику: переживает смену вкладки и экрана.
  // На снимке с `expand: "all"` — развёрнута.
  const [folded, setFolded] = useViewState(
    `views:folded:${object.address}#${metric.key}`,
    params.collapsed === true,
    { expanded: false },
  );
  const freshness = ago(source.updatedAt);

  const body =
    source.error && source.data === undefined ? (
      <div className="text-[var(--mw-errorForeground)]">{source.error}</div>
    ) : source.loading ? (
      // `data-loading` — заглушка загрузки: скриншот метрики ждёт, пока таких не останется.
      <div data-loading="" className={MUTED}>
        загружается…
      </div>
    ) : !source.answered ? (
      <div className={MUTED}>{params.empty ?? "не спрашивали"}</div>
    ) : (
      <Display
        kind={props.kind}
        data={props.shape ? props.shape(source.data) : source.data}
        empty={params.empty}
        onOpen={navigate}
        // Раскрытые папки дерева — у человека, свои на объект и метрику.
        id={`${object.address}#${metric.key}`}
      />
    );

  const marks = (
    <>
      {source.busy && <span className="animate-pulse">…</span>}
      {!source.busy && source.error && source.data !== undefined && (
        <span title={source.error} style={FAILED} className="shrink-0 cursor-help">
          ●
        </span>
      )}
    </>
  );

  // Статику обновлять неоткуда — кнопки у неё нет.
  const button = params.source && (
    <button
      type="button"
      onClick={source.refresh}
      title="Обновить"
      className="hidden shrink-0 opacity-60 group-hover:block hover:opacity-100"
    >
      <svg viewBox="0 0 16 16" className="size-4">
        <path
          d="M13 8a5 5 0 1 1-1.6-3.7M13 3v2.5h-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );

  // Превью объекта: только значение, состояние — значком в углу, кнопка — при наведении.
  if (compact) {
    return (
      <div className="group relative min-h-0 min-w-0">
        <div className="min-h-0 min-w-0 overflow-auto break-words">{body}</div>
        <span className="absolute top-0 right-0 flex items-center gap-1 text-[10px]">
          {marks}
          {button}
        </span>
      </div>
    );
  }

  return (
    <div className="group flex min-h-0 min-w-0 flex-col">
      <div className="relative flex shrink-0 items-center gap-1 text-[12px] font-semibold">
        <button
          type="button"
          onClick={() => setFolded(!folded)}
          title={folded ? "Показать" : "Скрыть"}
          // Стрелка висит в узком левом поле сетки: кнопка шириной с поле, уголок по её центру.
          className="absolute -left-2 flex w-2 justify-center opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
        >
          <svg
            viewBox="0 0 16 16"
            className={`size-4 shrink-0 transition-transform ${folded ? "" : "rotate-90"}`}
          >
            <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        {/* По стрелке шириной в поле попасть трудно — название сворачивает так же. */}
        <button
          type="button"
          onClick={() => setFolded(!folded)}
          title={folded ? "Показать" : "Скрыть"}
          className="min-w-0 truncate text-left"
        >
          {metric.label}
        </button>
        {marks}
        {button}
        {freshness && (
          <span className="ml-auto shrink-0 text-[10px] font-normal opacity-50">{freshness}</span>
        )}
      </div>
      {!folded && <div className="min-h-0 min-w-0 flex-1 overflow-auto break-words">{body}</div>}
    </div>
  );
}

/** Голый массив — тот же список: так отвечают скрипты и `files.tree` без обёртки. */
export const wrap =
  (key: string) =>
  (data: unknown): unknown =>
    Array.isArray(data) ? { [key]: data } : data;

/** Голая строка — тот же текст. */
export const text = (data: unknown): unknown => (typeof data === "string" ? { text: data } : data);
