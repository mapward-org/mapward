/**
 * Отмена прогона — решение 0013, `cancelOnLeave`. Свой тип, а не `AbortSignal`: тот приходит
 * из платформы, а пакет о платформе не знает. Порты его принимают, приложение вешает на него
 * то, что убивает процесс.
 */
export type Cancellation = {
  readonly cancelled: boolean;
  onCancel(handler: () => void): void;
};

/** Токен отмены и кнопка к нему: прогон отдаёт токен портам, стор держит кнопку. */
export function createCancellation(): { token: Cancellation; cancel: () => void } {
  let cancelled = false;
  const handlers: (() => void)[] = [];

  return {
    token: {
      get cancelled() {
        return cancelled;
      },
      onCancel(handler) {
        if (cancelled) handler();
        else handlers.push(handler);
      },
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const handler of handlers) handler();
    },
  };
}
