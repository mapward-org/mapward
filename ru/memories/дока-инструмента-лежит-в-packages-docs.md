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

Правка `.md` сама по себе до `read_docs` не доезжает: раздел отдаётся из
`packages/docs/src/content.generated.ts`, а он собирается `node packages/docs/scripts/bundle-docs.mjs`
(лежит в `.gitignore`, в диффе его не видно). `pnpm build` зовёт сборщик сам, но после одной
правки текста быстрее позвать скрипт.

Замечено 2026-09-20, дополнено 2026-09-21. Переезд решением не записан; запишут — это
наблюдение устареет.
