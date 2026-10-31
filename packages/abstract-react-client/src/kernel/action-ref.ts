/**
 * Экшон, названный строкой: `run` — ключ экшона объекта или полный адрес
 * `mapward://…/_actions/<ключ>`, `inputs` — значения его формы (решение 0038). Так экшон называют
 * компонент (`useAction`) и данные строк; разбирают его экшоны.
 */
export type ActionRef = { run: string; inputs?: Record<string, unknown> };
