/**
 * Кому кнопка этапа отправляет фразу — решение 0032. Первым идёт терминал, где эту директиву
 * последний раз запускали кнопкой: там уже лежит контекст её треда, и второй круг брейншторма,
 * уехавший в соседнюю сессию, начал бы разговор заново. Дальше прежний порядок решения 0017:
 * активный терминал объекта, потом первый живой. Никого — зовущий заводит новый.
 *
 * Кандидаты — только живые терминалы этого объекта. Запомненный терминал, которого среди них
 * нет, закрыт, и выбирать его нельзя.
 */
export function chooseRecipient(params: {
  remembered?: string;
  own: { id: string; active: boolean }[];
}): string | undefined {
  const { remembered, own } = params;
  if (remembered && own.some((session) => session.id === remembered)) return remembered;
  return (own.find((session) => session.active) ?? own[0])?.id;
}
