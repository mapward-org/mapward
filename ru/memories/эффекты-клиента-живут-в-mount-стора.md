---
description: в compose и entry клиента нет useEffect и логики — тест client-layers; подписки и реакции заводит mount стора в useLocalStore; Resource глотает одинаковые значения
---

`tests/client-layers.test.ts` (правила слоёв `abstract-react-client`) валит любой `useEffect`, `if`
и вычисление в `compose/` и `entry/` — даже в `object-view.tsx` и `app.tsx`. Подписку на мост или
`reaction` кладут в стор с методами `mount`/`unmount`: `useLocalStore` зовёт их сам, и строгий
режим React это переживает. Образцы — `directive-turns/model/turns-panel.ts`,
`focus/model/screen-focus.ts`.

`Resource` из `core` для потока событий не годится: равное по JSON значение он дальше не пускает,
и повторная одинаковая просьба (например, «перейди к объекту» второй раз) пропадёт. Для событий —
свой стор с `observableRef` и подпиской в `mount`, как `focus/adapters/focus-inbox.ts`.

2026-09-27.
