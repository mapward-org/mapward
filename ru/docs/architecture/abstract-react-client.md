# abstract-react-client

Интерфейс карты на React и tailwind, один на все хосты. Платформа приходит портами, сервер
виден только через контракт `core`. Решения [0014](../decisions/0014-client-server.md) и
[0015](../decisions/0015-package-layout.md).

Сокращённо зовётся `abstract-client`; пакет в репозитории — `abstract-react-client`.

## Структура

```
src/
  entry/                точки входа, сборка всего вместе
  features/
    <feature>/
      index.ts          что фича отдаёт наружу
      adapters/         зависимости на внешнее состояние — например на глобальный стор
      compose/          сборка: композирует model, ui, adapters, pure-model
      model/            состояние, которым владеет сам модуль
      ui/               вёрстка и состояние отображения
      pure-model/       типы и чистые функции модуля
  services/
    <service>/          переиспользуемый доменный модуль
      index.ts          что сервис отдаёт наружу
      adapters/
      compose/
      model/
      pure-model/
      ui/
  ports/                порты во внешний мир: мост к серверу, иконки хоста
  kernel/               переиспользуемые доменные типы и функции
  lib/                  переиспользуемое, к домену не относящееся: rxjs-биндинги, общий ui
```

Карту клиент собирает сам — живой моделью из `core` (решение
[0041](../decisions/0041-server-map-model-and-classes.md)): `features/map-object/adapters/use-map.ts`
подписывает её на файлы карты по мосту (`watchMapFile`, `watchMapFolder`), а экран объекта —
`observer` из `mobx-react-lite` и перерисовывается, когда меняется прочитанная им карта.

Сегодня в `services/` живёт `state` — состояние вида и состояние карты. Ими пользуются и
фичи, и подмодули, поэтому место им общее, а не внутри одной фичи.

История переходов объекта — чистые функции в `features/map-object/pure-model/navigation.ts`:
экран пишется строкой, история — список строк (решение
[0036](../decisions/0036-back-is-history.md)). Где её хранить, экран объекта не знает — это
решает `entry/app.tsx`: сайдбар кладёт её в состояние вида по карте, таб отдаёт хосту вместе с
тем, на чём он открыт.

Кнопка «ждут ответа» — фича `features/directive-turns`: число внизу сайдбара и список по клику.
Ставит её `entry/app.tsx` поверх карт, а не внутри одной: список один на окно, общий для всех
карт. В табе объекта её нет — решение [0034](../decisions/0034-directive-turns.md).

## Правила

```
compose -> (model|adapters|ui) -> pure-model
```

`model`, `adapters` и `ui` друг друга не импортируют — связь только через `compose`. Смысл
слоёв тот же, что в [расширении](vscode-extension.md), оттуда он и берётся: подмодуль может
использовать `pure-model` родителя, родитель обращается к подмодулю только из `compose`.

Порты доставляются контекстами: работа идёт в context first подходе. Контекст здесь не
хитрость, а способ передать зависимость вниз, не протаскивая её параметром через каждый
уровень.

Реализации портов — в приложениях. В пакете лежит только объявление и то, что от него
зависит.

Цвета и шрифты берутся из переменных `--mw-*`, значения им даёт хост: в редакторе — из темы
vscode, в браузере — из своих. Поэтому в коде клиента нет ни одного `--vscode-*`.

Иконки — такой же порт: клиент просит нарисовать по имени (`ports/icons.tsx`), а чем рисовать —
знает хост. В редакторе это шрифт codicon, и слова `codicon` в пакете нет.

Набор переменных и есть контракт темы — хосту достаточно заполнить его:

- `--mw-button-background`
- `--mw-button-foreground`
- `--mw-button-hoverBackground`
- `--mw-charts-blue`
- `--mw-charts-green`
- `--mw-charts-yellow`
- `--mw-descriptionForeground`
- `--mw-editor-background`
- `--mw-errorForeground`
- `--mw-font-family`
- `--mw-font-size`
- `--mw-foreground`
- `--mw-list-activeSelectionBackground`
- `--mw-list-hoverBackground`
- `--mw-menu-background`
- `--mw-menu-border`
- `--mw-panel-border`
- `--mw-testing-iconFailed`
- `--mw-testing-iconPassed`
- `--mw-testing-iconQueued`
- `--mw-textBlockQuote-background`
- `--mw-textBlockQuote-border`
- `--mw-textLink-foreground`
