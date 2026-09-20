---
description: объекты в shared-metrics несут config.json вместо _index.json — read_index по такому адресу отдаёт index null
---

`extends` метрики ведёт на адрес вида `mapward://shared-metrics/files`. Это обычный объект
карты, он есть в дереве и находится `findObject`, но в его папке лежит `config.json` метрики,
а `_index.json` нет.

Отсюда: `read_index { address: "mapward://shared-metrics/files" }` отвечает `index: null` —
выглядит как «объект пустой», хотя конфиг лежит рядом и читается файлом. Идти надо
в `ru/map/shared-metrics/<ключ>/config.json`.

Так же устроена и вторая половина цепочки: у `packages/core` метрика `files` наследуется от
`prototypes/package`, чей `_metrics/files/config.json` состоит из одной строки `extends`.
Полный конфиг — только на последнем слое.

Замечено 2026-09-20; закрыть это должна директива `2026-09-19-1348-add-metric-to-interface-and-mcp`.
