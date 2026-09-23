---
description: .gitignore режет packages/*/src/**/*.d.ts (выхлоп tsc) — ручное ambient-объявление клади в .ts без import/export
---

`tsc` кладёт `.d.ts` рядом с исходниками, поэтому они в `.gitignore`. Написанный руками
`declare module "*?raw"` в `raw.d.ts` молча не попал бы в коммит. Ambient-объявление живёт в
обычном `.ts` без импортов и экспортов (он тогда скрипт, и `declare module` в нём глобален) —
так сделан `packages/abstract-server/src/raw-modules.ts`. (2026-09-23)
