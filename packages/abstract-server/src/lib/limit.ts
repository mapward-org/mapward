/**
 * Очередь с лимитом параллельности — решение 0013: по умолчанию метрики собираются разом, но
 * когда их много или они тяжёлые, лимит ставится настройкой карты.
 */
export function createLimit(limit: number | undefined) {
  if (!limit || limit <= 0) return <T>(task: () => Promise<T>): Promise<T> => task();

  let running = 0;
  const waiting: (() => void)[] = [];

  const next = () => {
    running -= 1;
    waiting.shift()?.();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      next();
    }
  };
}
