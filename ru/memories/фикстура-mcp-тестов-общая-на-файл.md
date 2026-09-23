---
description: в mcp.test.ts одно дерево карты на весь файл, и новый объект под `packages/` ломает чужие тесты про children
---

`packages/abstract-server/src/entry/mcp.test.ts` держит одну фикстуру `tree` и один `ports` на
весь файл: `call()` поднимает сервер по ним. Тесты про `depth` и проекцию сверяют список детей
`mapward://packages` целиком, а тест про корень — детей корня.

Поэтому объект, добавленный в фикстуру под `packages/` или в корень, роняет чужие тесты, ничего
не сломав в коде. Новый объект под `prototypes/` безопаснее: его детей никто не перечисляет.

То же и в `features/map/application/services/map-model.test.ts` (бывший `read-map.test.ts`), но там фикстур несколько (`tree`, `workflowTree`, `layersTree`,
`groupsTree`) — новую проверку дешевле заводить своим деревом, чем дописывать в общее.
