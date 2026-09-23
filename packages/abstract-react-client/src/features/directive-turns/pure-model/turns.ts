import type { Turn } from "@mapward/core";

/**
 * Подпись пункта — «объект · директива · этап», как имя вкладки этапа. Имя директивы без даты,
 * времени и расширения, по тому же правилу, что строка списка директив (решение 0028): порядок
 * задаёт время срабатывания, а ширина уходит на дату первой.
 */
export const turnLabel = (turn: Turn): string =>
  `${turn.object} · ${turn.directive.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "")} · ${turn.stage}`;

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

/** На кнопке много не поместится: больше девяти — «9+». */
export const badge = (count: number): string => (count > 9 ? "9+" : String(count));
