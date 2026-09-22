/**
 * Чей терминал — по имени вкладки. Нужно только постоянным терминалам (решение 0032): редактор
 * возвращает их после перезагрузки окна, а память расширения о том, какой терминал чей, — нет.
 *
 * Запись ведётся по полному имени вкладки и несёт адрес объекта и полное имя директивы: в самой
 * вкладке директива идёт без даты, и две директивы с одинаковым названием по подписи не различить.
 */
export type Owner = { address: string; directive?: string };

export type Owners = Record<string, Owner>;

/** Какие из открытых вкладок — терминалы карты. Вкладки мимо записи не трогаем: они чужие. */
export function adopt(names: string[], owners: Owners): { index: number; owner: Owner }[] {
  return names.flatMap((name, index) => {
    const owner = Object.hasOwn(owners, name) ? owners[name] : undefined;
    return owner ? [{ index, owner }] : [];
  });
}
