/**
 * Кому уходит фраза — решение 0032. У директивы свой терминал: жив он — фраза туда, нет — никто,
 * и зовущий заводит новый. Чужие терминалы получателями не бывают: фраза, уехавшая в соседний
 * разговор, пачкает его, и заметить это можно только по тому, что агент взялся не за то.
 *
 * Кнопка «терминал» на объекте директиву не называет. Ей достаются только терминалы объекта без
 * директивы — активный, потом первый живой (решение 0017): иначе она влезла бы в разговор
 * директивы с другой стороны.
 *
 * Кандидаты — только живые терминалы этого объекта.
 */
export function chooseRecipient(params: {
  directive?: string;
  own: { id: string; directive?: string; active: boolean }[];
}): string | undefined {
  const { directive, own } = params;
  if (directive !== undefined) return own.find((session) => session.directive === directive)?.id;
  const free = own.filter((session) => session.directive === undefined);
  return (free.find((session) => session.active) ?? free[0])?.id;
}
