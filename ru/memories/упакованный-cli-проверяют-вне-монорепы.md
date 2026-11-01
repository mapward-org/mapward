---
description: CLI для npm бандлит @mapward/* из исходников (нужен ?raw сервера); проверять его — pnpm pack и npm install в пустую папку, а не node apps/cli/dist внутри репозитория
---

`@mapward/cli` публикуется одним пакетом: `apps/cli/tsdown.config.ts` вбирает `@mapward/*` (по
путям tsconfig, из `src`) и подключает плагин `raw` из `packages/abstract-server/tsdown.raw.ts` —
без него сборка падает на `@mapward/plugin/dist/index.mjs?raw`. Снаружи остаются `rxjs`, `typebox`,
`tailwindcss`, `esbuild-wasm` — они в `dependencies` CLI.

Внутри монорепы `node apps/cli/dist/cli.mjs` находит пакеты рабочего пространства и не покажет,
что чего-то не хватает. Проверка пакета: `pnpm pack` в `apps/cli` (подставляет `catalog:`
версиями), `npm install <tgz>` в пустой папке scratchpad, там `mapward.json` и `npx mapward …` —
так 2026-11-01 проверены `market search|read|add|diff` и `plugin check`.

На Windows в Bash папку `node_modules/.bin` в `PATH` клади через `cygpath -u`: путь `C:/…` дочерние
процессы с `shell: true` не находят («mapward не является командой»).
