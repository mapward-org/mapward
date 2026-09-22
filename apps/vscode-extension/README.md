# Расширение VS Code

Карта проекта в сайдбаре. Продукт — `ru/docs/requirements.md`, устройство кода —
[ru/docs/architecture/vscode-extension.md](../../ru/docs/architecture/vscode-extension.md), что сделано и что на очереди — требования в реестре
`ru/requirements` с `object: mapward://apps/vscode-application`, они же видны метриками
на объекте карты.

## Запустить

Из корня репозитория:

```sh
pnpm install
```

Дальше `F5` — конфигурация «Расширение» из `.vscode/launch.json`. Она сама соберёт
расширение и откроет **Extension Development Host** — второе окно VS Code, где расширение
уже установлено. Иконка mapward появится в activity bar, клик открывает карту в сайдбаре.

Открывать в хосте нужно тот проект, у которого есть карта. Сам этот репозиторий подходит:
`mapward.json` в корне указывает на `ru/map`.

## Разрабатывать

```sh
pnpm --filter @mapward/vscode-extension dev
```

Запускает два вотчера сразу: `tsdown` пересобирает оба бандла, `tailwindcss` — стили.

Хост при этом перезапускать не надо — достаточно `Developer: Reload Window` в окне хоста
(`Ctrl+Shift+P`). Изменения в вебвью видны после перезагрузки окна, изменения в extension
host — тоже.

## Собрать

```sh
pnpm --filter @mapward/vscode-extension build
pnpm --filter @mapward/vscode-extension typecheck
```

Из корня работают `pnpm test`, `pnpm lint`, `pnpm format` — они общие на репозиторий.

## Поставить в свой редактор

`F5` даёт Extension Development Host — второе окно, которое надо держать открытым. Чтобы
расширение просто стояло в основном редакторе:

```sh
pnpm --filter @mapward/vscode-extension install-local
```

Собирает прод-режимом, пакует в `.vsix` и ставит его через `code --install-extension`. Только
собрать, не ставя, — `pnpm --filter @mapward/vscode-extension package`; `.vsix` кладётся в
`build/`, папка не под git.

После установки нужен `Ctrl+Shift+P` → **Developer: Reload Window**: до перезагрузки в окне
работает прежняя сборка.

Пакуется не эта папка, а её слепок в `build/stage` — `dist/`, `media/`, `README.md` и
переписанный `package.json`. Так обходятся три вещи разом: `vsce` не принимает scoped-имя,
спотыкается о `"private": true` и не понимает `workspace:*`, а монорепе всё это нужно. Поэтому
`.vscodeignore` здесь нет: состав пакета задаёт слепок. Подробности — у кода в
`scripts/package-vsix.mjs`, почему так — в
[решении 0030](../../ru/docs/decisions/0030-local-distribution.md).

Версия берётся из `package.json` и общая с монорепой: двигают её changeset'ы, упаковка только
читает. Пока номер не бампнули, ставится та же версия поверх себя — поэтому установка идёт
с `--force`.

**Два окна на одну карту — не надо.** Установленное расширение и Extension Development Host
поднимают каждый свой MCP-сервер и свой стор метрик, а решение
[0009](../../ru/docs/decisions/0009-mcp.md) держится на том, что писатель один.

## Два бандла

Расширение живёт в двух рантаймах, и сборок тоже две:

| | точка входа | формат | где выполняется |
|---|---|---|---|
| `dist/extension.cjs` | `src/apps/extension/main.ts` | cjs | extension host, есть `vscode` и файлы |
| `dist/webview.mjs` | `src/apps/webview/main.tsx` | esm | вебвью, только браузерное окружение |

`dist/webview.css` пишет tailwind отдельным шагом. Поэтому `clean` у обеих сборок сужен до
своих файлов: сплошная очистка `dist` в watch-режиме стирала бы стили на каждой пересборке.

В вебвью нет резолвера модулей, поэтому в его бандл входит всё, включая react. Какой именно
react туда попадёт, решает `NODE_ENV`: обычная сборка — дев-режим с читаемыми стектрейсами
(1.6 МБ), упаковка в `.vsix` ставит `NODE_ENV=production` и получает минифицированный бандл
(0.5 МБ). Переменная объявлена входом задачи `build` в `turbo.json`, иначе turbo подставил бы
одну сборку под видом другой.

Между рантаймами только `postMessage`: типы сообщений в `src/kernel/bridge.ts`, транспорт —
в `src/shared/bridge/`.
