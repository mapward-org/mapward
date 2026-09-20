---
description: типы проверяются `pnpm typecheck` (turbo по пакетам); `tsc -b` с корня врёт — у корня нет ни jsx, ни путей пакетов
---

`tsc` из корня репозитория выдаёт десятки ложных ошибок: `--jsx is not set` на каждый `.tsx`,
`Cannot find module '@/...'` в расширении, `Cannot find name 'window'`. Своего tsconfig,
покрывающего репозиторий, здесь нет — конфиги лежат по пакетам, и typecheck запускается только
через turbo:

```
pnpm typecheck     # turbo run typecheck, по пакету за раз
pnpm test          # vitest с корня, весь репозиторий
pnpm lint          # oxlint; ошибки и предупреждения вперемешку, смотреть на слово error
pnpm format        # oxfmt, без --check правит на месте
```

Порядок после правки кода: `typecheck` → `test` → `format` → `lint`. `format` переносит длинные
строки и меняет кавычки, поэтому гонять его до `lint` дешевле, чем после.
