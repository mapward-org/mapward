/**
 * Что сейчас на экране объекта — решение 0036: сам объект, открытая вкладка, мета-экран и
 * метрика во всю ширину. Шагом истории считается только объект, остальное — его уточнение.
 */
export type Screen = { address: string; group?: string; meta?: boolean; solo?: string };

/**
 * История вида — строки экранов и номер текущего. Строка, а не объект: её сохраняют целиком,
 * а читается она так же, как адрес карты.
 */
export type History = { entries: string[]; index: number };

/** Историю сохраняют целиком, и без предела она росла бы вечно. */
export const historyLimit = 50;

const root = "mapward://";

/**
 * `mapward://packages/core?group=тяжёлое&meta&solo=files`. Уточнения — в query, а не в хэше:
 * `#` в адресах карты уже занят путём к полю (решение 0005).
 */
export function screenToString(screen: Screen): string {
  const params: string[] = [];
  if (screen.group !== undefined) params.push(`group=${encodeURIComponent(screen.group)}`);
  if (screen.meta) params.push("meta");
  if (screen.solo !== undefined) params.push(`solo=${encodeURIComponent(screen.solo)}`);
  return params.length > 0 ? `${screen.address}?${params.join("&")}` : screen.address;
}

export function parseScreen(text: string): Screen {
  const at = text.indexOf("?");
  if (at === -1) return { address: text };
  const params = new URLSearchParams(text.slice(at + 1));
  const group = params.get("group");
  const solo = params.get("solo");
  return {
    address: text.slice(0, at),
    ...(group === null ? {} : { group }),
    ...(params.has("meta") ? { meta: true } : {}),
    ...(solo === null ? {} : { solo }),
  };
}

export const startHistory = (screen: Screen = { address: root }): History => ({
  entries: [screenToString(screen)],
  index: 0,
});

export const currentScreen = (history: History): Screen =>
  parseScreen(history.entries[history.index] ?? root);

/**
 * Переход на другой объект: новый шаг, а всё, что было «вперёд», отрезается — как в браузере.
 * Переход на тот же объект шага не кладёт, иначе «назад» стоял бы на месте; экран при этом
 * становится обычным видом объекта, как и при любом переходе.
 */
export function visit(history: History, address: string): History {
  const fresh = screenToString({ address });
  if (currentScreen(history).address === address) return replace(history, fresh);
  const entries = [...history.entries.slice(0, history.index + 1), fresh].slice(-historyLimit);
  return { entries, index: entries.length - 1 };
}

/** Вкладка, мета-экран и метрика шагами не считаются: они переписывают текущий шаг. */
export function amend(history: History, change: Omit<Partial<Screen>, "address">): History {
  const screen = { ...currentScreen(history), ...change };
  const clean: Screen = {
    address: screen.address,
    ...(screen.group === undefined ? {} : { group: screen.group }),
    ...(screen.meta ? { meta: true } : {}),
    ...(screen.solo === undefined ? {} : { solo: screen.solo }),
  };
  return replace(history, screenToString(clean));
}

const replace = (history: History, entry: string): History => ({
  entries: history.entries.map((old, index) => (index === history.index ? entry : old)),
  index: history.index,
});

/**
 * Куда ведёт стрелка: ближайший шаг в эту сторону, объект которого ещё есть на карте. Объект
 * переименовали или удалили, пока вид был открыт, — такой шаг перешагивается, а не роняет вид
 * на корень. Идти некуда — `undefined`, и стрелка гаснет.
 */
export function stepTarget(
  history: History,
  direction: -1 | 1,
  alive: (address: string) => boolean,
): number | undefined {
  for (
    let index = history.index + direction;
    index >= 0 && index < history.entries.length;
    index += direction
  ) {
    const entry = history.entries[index];
    if (entry !== undefined && alive(parseScreen(entry).address)) return index;
  }
  return undefined;
}

export const stepTo = (history: History, index: number): History => ({
  entries: history.entries,
  index,
});

/** Сохранённое читается из хранилища вида как есть: чужое или испорченное — истории нет. */
export function isHistory(value: unknown): value is History {
  if (typeof value !== "object" || value === null) return false;
  const { entries, index } = value as Partial<History>;
  return (
    Array.isArray(entries) &&
    entries.length > 0 &&
    entries.every((entry) => typeof entry === "string") &&
    typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < entries.length
  );
}
