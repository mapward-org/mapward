---
description: тест, импортирующий другой пакет по имени (@mapward/abstract-server в apps, @mapward/core в abstract-server), получает dist, а не исходники — перед ним pnpm build пакета
---

Пакеты внутри себя тестируются по исходникам, а `apps/cli/src/*.test.ts` и
`apps/vscode-extension/src/*.test.ts` импортируют `@mapward/abstract-server` по имени — vitest
резолвит его через `package.json` в `dist`. Правка сервера без
`npx turbo run build --filter=@mapward/abstract-server` в таком тесте не видна: тест проверяет
прошлую сборку и падает (или проходит) не по делу. Типы (`pnpm typecheck`) при этом идут по
исходникам через `paths`, так что расхождение видно только в тестах. (2026-09-23)

То же внутри пакетов: тесты `packages/abstract-server` берут `@mapward/core` из его `dist`. После
правки в `core` без `pnpm --filter @mapward/core build` сервер падает на ровном месте —
`LiveFiles is not a constructor` (2026-09-23).
