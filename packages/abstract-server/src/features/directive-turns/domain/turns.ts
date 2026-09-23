/**
 * Директивы, где ход у человека: этап кончился, а следующего никто не запустил. При нескольких
 * агентах разом это его стек задач — кому он ещё не ответил (решение 0034).
 *
 * Список, а не журнал: у директивы один пункт, и повторный конец этапа поднимает его наверх, а
 * не добавляет второй. Уходит пункт, когда человек взял ход, — поэтому список не копится.
 */
export type Turn = {
  mapPath: string;
  address: string;
  /** Имя объекта — чтобы показать пункт, не читая карту заново. */
  object: string;
  directive: string;
  /** Файл директивы: по клику открывается он. */
  path: string;
  stage: string;
  /** Когда кончился этап, ISO-строкой: пункт уезжает через мост. */
  at: string;
};

/**
 * Директива узнаётся по трём вещам: имя файла у разных объектов совпадает, а адрес объекта у
 * разных карт окна.
 */
export type TurnKey = Pick<Turn, "mapPath" | "address" | "directive">;

const same = (a: TurnKey, b: TurnKey) =>
  a.mapPath === b.mapPath && a.address === b.address && a.directive === b.directive;

/** Этап кончился: пункт наверх, свежий. */
export const stageFinished = (turns: readonly Turn[], turn: Turn): Turn[] => [
  turn,
  ...turns.filter((entry) => !same(entry, turn)),
];

/**
 * Человек взял ход — запустил следующий этап или открыл пункт. Нечего убирать — тот же список,
 * чтобы подписчики не получали изменение, которого не было.
 */
export const turnTaken = (turns: Turn[], key: TurnKey): Turn[] =>
  turns.some((entry) => same(entry, key)) ? turns.filter((entry) => !same(entry, key)) : turns;
