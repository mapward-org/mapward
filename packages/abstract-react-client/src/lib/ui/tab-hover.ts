/**
 * Классы подсветки. Строки целиком, а не склейкой: tailwind находит классы по тексту исходника.
 *
 * - `tabLink` — ссылка, которая откроется табом: подчёркнута на ховере всегда, под ctrl — ещё и рука;
 * - `plainLink` — ссылка, которая табом не откроется (файл, наружу): под ctrl подчёркивание теряет;
 * - `tabOnly` — то, что ссылкой не выглядит (вкладка, узел карты, заголовок метрики): подчёркнуто
 *   только под ctrl.
 */
export const tabHover = {
  tabLink: "hover:underline in-data-[tab-mod]:hover:cursor-pointer",
  plainLink: "not-in-data-[tab-mod]:hover:underline",
  tabOnly: "in-data-[tab-mod]:hover:underline in-data-[tab-mod]:hover:cursor-pointer",
};
