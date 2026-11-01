/**
 * Терминал заводится на объект (решение 0017), а объект переживает не один разговор. Значит
 * второй терминал того же объекта — это второй терминал, а не перезапуск первого, и отличать
 * их должно имя.
 *
 * Номер, а не время: его видно в узкой вкладке, и по нему понятно, какой из них какой.
 */
export function freeName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  // Предел условный: столько живых терминалов на одном объекте означает, что что-то не так,
  // и падать из-за этого всё равно незачем.
  for (let next = 2; next < 100; next++) {
    const candidate = `${base} ${next}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/**
 * Имя вкладки на время этапа: по нему видно, кто из сессий чем занят, без заглядывания внутрь
 * (решение 0017). Имя директивы приходит файлом — с датой, временем и расширением, — а вкладка
 * узкая, поэтому в имя идёт только суть.
 */
export const shortDirective = (directive: string) =>
  directive.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "");

/**
 * Имя вкладки на время этапа. Ставится в начале этапа и остаётся после конца: чем разговор
 * занимался, важно не меньше, чем чем он занят. Отметки о конце нет — переименовать можно только
 * активный терминал, а активация увела бы человека к его директиве посреди параллельной работы.
 */
export const stageName = (params: { base: string; directive: string; stage: string }) =>
  `${params.base} · ${shortDirective(params.directive)} · ${params.stage}`;

/** Имя вкладки терминала, заведённого открытием директивы: этапа ещё нет, есть объект и директива. */
export const directiveTabName = (params: { base: string; directive: string }) =>
  `${params.base} · ${shortDirective(params.directive)}`;
