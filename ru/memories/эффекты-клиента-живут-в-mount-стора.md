---
description: в compose и entry клиента нет useEffect и логики — тест client-layers; подписки заводит mount стора в useLocalStore, вид подписывается useWatch
---

`tests/client-layers.test.ts` (правила слоёв `abstract-react-client`) валит любой `useEffect`, `if`
и вычисление в `compose/` и `entry/` — даже в `object-view.tsx` и `app.tsx`. Подписку на мост
кладут в стор с методами `mount`/`unmount`: `useLocalStore` зовёт их сам, и строгий режим React
это переживает. Образцы — `directive-turns/model/turns-panel.ts`, `focus/adapters/focus-inbox.ts`.

С ухода с MobX (ветка `plugin-architecture`, 2026-10-31) сторы — `Reactive` из `lib/store`, ресурсы
моста — `Feed`. Компонент читает стор только после `useWatch(стор…)`: забытый `useWatch` тест не
ловит — компонент просто не перерисуется.

2026-09-27, поправлено 2026-10-31.
