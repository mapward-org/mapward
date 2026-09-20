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
 * Этап кончился — имя не возвращается к объекту, а помечается завершённым: чем этот разговор
 * занимался, важно не меньше, чем чем он занят. Следующий запуск имя перетирает.
 */
export const stageName = (params: {
  base: string;
  directive: string;
  stage: string;
  done?: boolean;
}) =>
  `${params.base} · ${shortDirective(params.directive)} · ${params.stage}${
    params.done ? " ✓" : ""
  }`;
