/**
 * Последний ответ одного запроса — то, что стор запроса берёт у памяти вида.
 */
export type CallSlot<T> = {
  /** Последний ответ, если он был; `undefined` значением тоже ответ, поэтому обёрткой. */
  last(): { value: T } | undefined;
  remember(value: T): void;
  /** Запрос на экране: пока держат, ответ не забывается. Отдаёт «отпустить». */
  hold(): () => void;
};

type Entry = { answer: { value: unknown } | undefined; held: number; releasedAt: number };

/** Сколько запросов без подписчиков помнится: дальше забывается самый давний. */
const MAX_FREE = 200;

/** Сколько ответ без подписчиков помнится: вернулись много позже — честнее «загружается». */
const FREE_FOR_MS = 10 * 60_000;

/**
 * Последние ответы запросов компонентов — одна память на вид объекта, как кэш react-query.
 * Вернулась клетка с тем же ключом — её запрос начинает с прошлого ответа, а не с пустоты, и
 * клетка не прыгает, пока плагин отвечает заново. Свежесть держит сам поток метода: подписка
 * заново присылает текущее, и оно заменяет запомненное. Изменения (`useMutation`) сюда не ходят.
 */
export class CallMemory {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  slot<T>(id: string): CallSlot<T> {
    return {
      last: () => this.answer(id) as { value: T } | undefined,
      remember: (value) => {
        const entry = this.entry(id);
        entry.answer = { value };
        // Свежий ответ — в конец очереди: забывается самый давний.
        this.entries.delete(id);
        this.entries.set(id, entry);
        this.trim();
      },
      hold: () => {
        this.entry(id).held += 1;
        let held = true;
        return () => {
          if (!held) return;
          held = false;
          const entry = this.entry(id);
          entry.held -= 1;
          if (entry.held === 0) entry.releasedAt = this.now();
        };
      },
    };
  }

  private entry(id: string): Entry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { answer: undefined, held: 0, releasedAt: this.now() };
      this.entries.set(id, entry);
    }
    return entry;
  }

  /** Ответ, если он есть и не устарел без подписчиков. */
  private answer(id: string): { value: unknown } | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.held === 0 && this.now() - entry.releasedAt > FREE_FOR_MS) {
      this.entries.delete(id);
      return undefined;
    }
    return entry.answer;
  }

  private trim(): void {
    const free = [...this.entries].filter(([, entry]) => entry.held === 0);
    for (const [id] of free.slice(0, Math.max(0, free.length - MAX_FREE))) this.entries.delete(id);
  }
}
