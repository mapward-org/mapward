import type { Turn } from "@mapward/core";

const shortDirective = (directive: string) =>
  directive.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "");

/**
 * Подпись пункта — «объект · директива · этап», как имя вкладки этапа, у экшона — «объект ·
 * экшон». Имя директивы без даты, времени и расширения, по тому же правилу, что строка списка
 * директив (решение 0028): порядок задаёт время срабатывания, а ширина уходит на дату первой.
 */
export const turnLabel = (turn: Turn): string =>
  turn.kind === "directive"
    ? `${turn.object} · ${shortDirective(turn.directive)} · ${turn.stage}`
    : `${turn.object} · ${turn.label}`;

/** Ключ пункта в списке: директива — объектом и файлом, прогон — номером. */
export const turnKey = (turn: Turn): string =>
  turn.kind === "directive"
    ? `${turn.mapPath}\n${turn.address}\n${turn.directive}`
    : `${turn.mapPath}\n${turn.run}`;

/** Что с пунктом, словом рядом со временем: ждущее молчит, остальное называется. */
export const stateLabel = (turn: Turn): string | undefined =>
  turn.state === "running" ? "идёт" : turn.state === "failed" ? "упал" : undefined;

/**
 * Сколько ждёт: точные часы не нужны, нужно видеть, кто ждёт дольше. Будущее (часы хоста
 * и вебвью разошлись) читается как «только что».
 */
export const waited = (at: string, now: number): string => {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (!(minutes >= 1)) return "только что";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
};

/**
 * Что показать на кнопке. Число — то, что ждёт человека: ответа или взгляда на упавшее; идущее
 * его не прибавляет. Ждать нечего, но что-то идёт — лоадер вместо числа.
 */
export const buttonState = (turns: readonly Turn[]): { count: number; busy: boolean } => ({
  count: turns.filter((turn) => turn.state !== "running").length,
  busy: turns.some((turn) => turn.state === "running"),
});

/** На кнопке много не поместится: больше девяти — «9+». */
export const badge = (count: number): string => (count > 9 ? "9+" : String(count));
