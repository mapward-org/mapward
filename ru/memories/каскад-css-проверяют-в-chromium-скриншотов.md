---
description: каскад css (@scope, слои) jsdom не считает — корневой тест берёт Chromium из кэша плагина скриншотов; tailwind из корня не резолвится, только через createRequire от abstract-server
---

Как браузер разрешает конфликт правил (`@scope`, порядок слоёв), jsdom не считает. Настоящий
Chromium уже лежит в кэше плагина скриншотов (`~/.mapward/screenshot`, `launchChromium` из
`packages/plugins/registry/screenshot/browser.ts`), и корневой тест в `tests/` может его взять;
нет кэша — `test.skipIf`, а не установка по сети. Образец — `tests/component-css-scope.test.ts`.

`tailwindcss` стоит у `abstract-server`, а не в корне: `import "tailwindcss"` из `tests/` падает.
Берётся `createRequire(<abstract-server>/package.json)`.

2026-10-31.
