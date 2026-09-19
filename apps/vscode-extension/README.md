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

## Два бандла

Расширение живёт в двух рантаймах, и сборок тоже две:

| | точка входа | формат | где выполняется |
|---|---|---|---|
| `dist/extension.cjs` | `src/apps/extension/main.ts` | cjs | extension host, есть `vscode` и файлы |
| `dist/webview.mjs` | `src/apps/webview/main.tsx` | esm | вебвью, только браузерное окружение |

`dist/webview.css` пишет tailwind отдельным шагом. Поэтому `clean` у обеих сборок сужен до
своих файлов: сплошная очистка `dist` в watch-режиме стирала бы стили на каждой пересборке.

В вебвью нет резолвера модулей, поэтому в его бандл входит всё, включая react. Сейчас это
дев-сборка react — при работе над размером первым делом стоит выставить `NODE_ENV`.

Между рантаймами только `postMessage`: типы сообщений в `src/kernel/bridge.ts`, транспорт —
в `src/shared/bridge/`.
