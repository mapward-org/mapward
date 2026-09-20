import type { ClockPort, TimersPort } from "../ports/index.ts";

/**
 * Дебаунс на портах среды — решение 0023: ни таймеров, ни часов у сервера своих нет.
 *
 * Нужен вотчеру встроенного шага: одна команда git трогает `.git/index` и `.git/HEAD` несколько
 * раз подряд, а переключение ветки — десятки раз, и без задержки каждая запись означала бы свой
 * прогон трансформа.
 *
 * Ждём тишины, а не окна от первого тика: `git checkout` пишет всю серию, и прогон посреди неё
 * прочитал бы репозиторий в разобранном состоянии.
 */
export function debounce(
  timers: TimersPort,
  clock: ClockPort,
  ms: number,
  run: () => void,
): { tick: () => void; cancel: () => void } {
  let last = 0;
  let armed = false;

  const now = () => Date.parse(clock.now());

  const fire = () => {
    if (!armed) return;
    // Тик пришёл, пока таймер шёл: ждём остаток, иначе сработаем не по тишине, а по первому.
    const quiet = now() - last;
    if (quiet < ms) {
      timers.after(ms - quiet, fire);
      return;
    }
    armed = false;
    run();
  };

  return {
    tick() {
      last = now();
      // Отменять таймер нечем — `after` отдаёт только факт истечения; поэтому второй таймер
      // не заводится, а идущий сам продлевает себя, пока тики не кончатся.
      if (armed) return;
      armed = true;
      timers.after(ms, fire);
    },
    /** Снять отложенное: подписчик ушёл, и звать его больше не за чем. */
    cancel() {
      armed = false;
    },
  };
}
