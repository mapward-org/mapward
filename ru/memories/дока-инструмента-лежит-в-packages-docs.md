---
description: публичная дока mapward живёт в packages/docs/ru/, а решение 0012 всё ещё шлёт в ru/docs/mapward/
---

Текст про сам инструмент — модель, `_index.json`, адресация, метрики, директивы, MCP — лежит в
`packages/docs/ru/`. Это те же разделы, что отдаёт `read_docs`: `packages/docs/ru/directives.md`
дословно совпадает с `read_docs { section: "directives" }`, и правится именно файл.

Решение [`0012`](../docs/decisions/0012-guide.md), раздел «Место», называет местом
`ru/docs/mapward/` — такой папки нет. В `ru/docs/` остались `decisions/`,
`development-guide/`, `architecture/`, `ideas.md`, `requirements.md`.

Отсюда обычная ошибка: правку буквы доки ищут в `ru/docs/` и не находят, а `read_docs` выглядит
как текст без файла. Правишь механику инструмента — иди в `packages/docs/ru/`; правишь «как мы
этим пользуемся» — в `ru/docs/development-guide/`.

Замечено 2026-09-20. Переезд решением не записан; запишут — это наблюдение устареет.
