/**
 * Лента активности в кружке сайдбара: что идёт и где ход у человека. При нескольких агентах разом
 * это его стек задач — что ещё крутится и кому он ещё не ответил (решение 0034).
 *
 * Список, а не журнал: у директивы и у прогона по пункту, и новое событие меняет пункт и поднимает
 * его наверх, а не добавляет второй. Уходит пункт, когда человек взял ход или когда смотреть
 * больше не на что, — поэтому список не копится.
 */

/** Где пункт: адрес объекта у разных карт окна совпадает, поэтому с картой. */
type Place = {
  mapPath: string;
  address: string;
  /** Имя объекта — чтобы показать пункт, не читая карту заново. */
  object: string;
  /** Когда пункт стал таким, ISO-строкой: он уезжает через мост. */
  at: string;
};

/** Этап директивы: идёт, пока агент его не кончил, потом ждёт ответа человека. */
export type DirectiveTurn = Place & {
  kind: "directive";
  state: "running" | "waiting";
  directive: string;
  /** Файл директивы: по клику открывается он. */
  path: string;
  stage: string;
};

/**
 * Прогон экшона: идёт, а упал — ждёт, пока его посмотрят. Успешный пропадает сам: смотреть в нём
 * не на что, а что он сделал, видно в метриках объекта.
 */
export type ActionTurn = Place & {
  kind: "action";
  state: "running" | "failed";
  /** Номер прогона: по клику открывается он на экране прогонов объекта. */
  run: string;
  label: string;
};

export type Turn = DirectiveTurn | ActionTurn;

/** Какая директива: имя файла у разных объектов совпадает, а адрес объекта у разных карт окна. */
export type DirectiveKey = Pick<DirectiveTurn, "mapPath" | "address" | "directive">;
/** Какой прогон: номер уникален в своей карте. */
export type RunKey = Pick<ActionTurn, "mapPath" | "run">;
export type TurnKey = DirectiveKey | RunKey;

const same = (entry: Turn, key: TurnKey): boolean => {
  if (entry.mapPath !== key.mapPath) return false;
  if ("run" in key) return entry.kind === "action" && entry.run === key.run;
  return (
    entry.kind === "directive" && entry.address === key.address && entry.directive === key.directive
  );
};

/** Пункт поменялся: он наверх, свежий, прежний того же ключа уходит. */
export const upsert = (turns: readonly Turn[], turn: Turn): Turn[] => [
  turn,
  ...turns.filter((entry) => !same(entry, turn)),
];

/**
 * Убрать пункт. Нечего убирать — тот же список, чтобы подписчики не получали изменение, которого
 * не было.
 */
export const removed = (turns: Turn[], key: TurnKey): Turn[] =>
  turns.some((entry) => same(entry, key)) ? turns.filter((entry) => !same(entry, key)) : turns;

/**
 * Человек взял ход — открыл пункт. Идущее по клику не пропадает: оно уйдёт само, когда кончится,
 * иначе клик прятал бы то, что ещё работает.
 */
export const turnTaken = (turns: Turn[], key: TurnKey): Turn[] =>
  turns.some((entry) => same(entry, key) && entry.state !== "running")
    ? removed(turns, key)
    : turns;
