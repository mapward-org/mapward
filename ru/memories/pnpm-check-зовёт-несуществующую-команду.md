---
description: скрипт `pnpm check` в корневом package.json падает — у cli нет команды `check`
---

`"check": "node apps/cli/dist/cli.mjs check map"` в корневом `package.json` не работает:
у cli четыре команды — `maps`, `object`, `metric`, `mcp` (`apps/cli/src/cli.ts`), и `check`
среди них нет. Вызов печатает справку и выходит с кодом 1, то есть выглядит как упавшая
проверка карты, хотя с картой всё в порядке.

Полный набор рабочих проверок: `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
`pnpm build`. Карта проверяется чтением через MCP, а не этим скриптом.

Замечено 2026-09-20. Либо скрипт устарел, либо команду не довезли — если `check` появится,
эту запись надо убрать.
