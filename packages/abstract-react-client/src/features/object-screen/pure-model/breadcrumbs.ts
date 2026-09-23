import { trail, type MapObject } from "@mapward/core";

/** Крошка — это ссылка на объект: только то, чем её рисуют и куда она ведёт. */
export type Crumb = { address: string; name: string };

/**
 * Путь к объекту крошками. Группа — папка без `_index.json`, объекта за ней нет, и уход в неё
 * открывал бы экран ни о чём; на карте её тоже не видно — `childrenMap` поднимает её детей
 * уровнем выше. Поэтому в крошках остаются только объекты, и родителем считается ближайший
 * объект выше, а не ближайшая папка: кнопка назад ведёт туда же, куда последняя крошка.
 *
 * Сам объект в путь не идёт — он написан заголовком рядом.
 */
export const breadcrumbTrail = (map: MapObject, address: string): Crumb[] =>
  trail(map, address)
    .slice(0, -1)
    .filter((step) => !step.isGroup)
    .map((step) => ({ address: step.address, name: step.name }));

/**
 * Крошки по предкам, которые назвала живая карта: без обхода всего дерева — читаются только
 * папки на пути и индексы предков. Правило то же: группы в крошках не стоят.
 */
export const crumbsOf = (ancestors: MapObject[]): Crumb[] =>
  ancestors
    .filter((step) => !step.isGroup)
    .map((step) => ({ address: step.address, name: step.name }));
