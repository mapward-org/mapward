---
description: TypeScript 7 нативный, JS-API парсера у него нет — AST-тесты пишем на oxc-parser, а он сохраняет ParenthesizedExpression; в MobX 7 нет observable.ref — это observableRef
---

С 2026-09-24. `import ts from "typescript"` в тестах не даёт `createSourceFile`: TypeScript 7 —
нативный бинарник без JS-API. Тест слоёв клиента (`tests/client-layers.test.ts`) парсит
`oxc-parser` (`parseSync`), он в каталоге и в devDependencies корня.

Подвохи: oxc оставляет скобки узлом `ParenthesizedExpression` — `() => (<X/>)` имеет тело-скобку,
разворачивай перед проверкой типа. Узлы несут `start`/`end` — смещения, строку считай по тексту.

MobX 7: `observable.ref` нет, аннотация — `observableRef` импортом из `mobx`.
