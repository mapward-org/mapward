import type { ReactNode } from "react";
import type { MapAction, MapMetric, MapObject, MapStage } from "@mapward/core";
import { ListRow } from "../../../lib/ui/list-row.tsx";
import { howCollected, originHint, ownerHint } from "../pure-model/meta.ts";

/** Меню строки — кнопка «слои» и пункты под ней (решение 0028). */
type Menu = { label: string; actions: { key: string; label: string; onSelect: () => void }[] };

/**
 * Второй режим объекта: всё, что объект о себе знает, — вместо ряда меню в шапке
 * (решение 0024). Показывает и то, чего хост открыть не умеет: имена, происхождение
 * и `props` — это текст, а не действие, и `0014` их не запрещает.
 *
 * Поиск один на весь экран: поле стоит над разделами и не уезжает при прокрутке, а каждый
 * раздел показывает только совпавшие строки. Что совпало, считает `searchMeta`.
 */
export function MetaFrame(props: {
  /** Набранный запрос — поле откликается сразу, а найденное может догонять его позже. */
  query: string;
  onQuery: (query: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        type="search"
        value={props.query}
        placeholder="поиск по объекту"
        onChange={(event) => props.onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onQuery("");
        }}
        className="mx-3 my-1 shrink-0 rounded-sm border border-[var(--mw-input-border,#8884)] bg-[var(--mw-input-background,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--mw-input-foreground,inherit)] outline-none focus:border-[var(--mw-focusBorder,#48f)]"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto pb-6">{props.children}</div>
    </div>
  );
}

/** Не совпало нигде — одна строка об этом, а не пустые заголовки разделов. */
export function MetaNothing() {
  return <p className="px-3 py-0.5 text-[11px] opacity-50">не нашлось</p>;
}

export function ObjectRow(props: { object: MapObject; menu: Menu | undefined }) {
  const hint = originHint(props.object.layers);
  return (
    <ListRow
      label={props.object.name}
      title={props.object.address}
      {...(hint === undefined ? {} : { hint })}
      {...(props.menu === undefined ? {} : { menu: props.menu })}
    />
  );
}

/** `props` объекта таблицей «ключ — значение»; длинное режется, целиком висит тултипом. */
export function ObjectFields(props: { fields: { key: string; value: string }[] }) {
  return props.fields.length === 0 ? null : (
    <dl className="flex flex-col px-3 pt-1 text-[11px] opacity-70">
      {props.fields.map((row) => (
        <div key={row.key} className="flex gap-2">
          <dt className="w-28 shrink-0 truncate" title={row.key}>
            {row.key}
          </dt>
          <dd className="truncate" title={row.value}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function MetricRow(props: { metric: MapMetric; menu: Menu | undefined }) {
  const { metric } = props;
  const hint = originHint(metric.layers);
  return (
    <ListRow
      label={metric.config.label ?? metric.key}
      title={howCollected(metric)}
      {...(hint === undefined ? {} : { hint })}
      {...(props.menu === undefined ? {} : { menu: props.menu })}
    />
  );
}

/**
 * Откуда этап взялся: свой, от прототипа или дефолт инструмента. Иначе по экрану не отличить
 * настроенный воркфлоу от встроенного (решение 0017).
 */
export function StageRow(props: { stage: MapStage; onOpen: (() => void) | undefined }) {
  const { stage } = props;
  return (
    <ListRow
      label={stage.name}
      hint={stage.path === "" ? "по умолчанию" : (ownerHint(stage.owner) ?? "свой")}
      {...(stage.marksDone ? { hintClass: "text-[var(--mw-charts-green,#3a3)]" } : {})}
      {...(props.onOpen === undefined ? {} : { onSelect: props.onOpen })}
    />
  );
}

export function ActionRow(props: { action: MapAction; onOpen: (() => void) | undefined }) {
  const { action } = props;
  const hint = ownerHint(action.owner);
  return (
    <ListRow
      label={action.config.label ?? action.key}
      {...(hint === undefined ? {} : { hint })}
      {...(props.onOpen === undefined ? {} : { onSelect: props.onOpen })}
    />
  );
}
