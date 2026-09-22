---
description: VS Code кладёт в вебвью `scrollbar-color` на `html` — пока он не снят, `::-webkit-scrollbar` игнорируется и полосы рисуются со стрелками и чёрной дорожкой
---

Стили по умолчанию вебвью лежат в установке редактора:
`Microsoft VS Code/<хэш>/resources/app/out/vs/workbench/contrib/webview/browser/pre/index.html`,
в `@layer vscode-default`. Там `html { scrollbar-color: <ползунок> <фон редактора> }` — свойство
наследуется, и хромиум у всех вложенных прокруток рисует стандартную полосу (стрелки, дорожка
цвета редактора), не слушая `::-webkit-scrollbar`. Снимается в `apps/vscode-extension/src/apps/webview/index.css`
правилом `html { scrollbar-color: auto }` без слоя. Проверено 2026-09-23.
