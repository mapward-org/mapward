---
description: _index.json карты форматируется oxfmt только через stdin — по пути ru/** игнорируется, а prettier даёт другой стиль
---

`.oxfmtrc.json` игнорирует `map/**`, `ru/**` и `**/*.md`, поэтому `pnpm exec oxfmt ru/map/...`
отвечает «Expected at least one target file» и ничего не делает. При этом файлы карты
отформатированы именно oxfmt (короткие массивы в строку, ширина 100): после правки скриптом
(`JSON.stringify(…, null, 2)`) стиль возвращается так:

```sh
pnpm exec oxfmt --stdin-filepath=x.json < ru/map/_index.json > tmp.json && cp tmp.json ru/map/_index.json
```

`npx prettier` не подходит: переносит массивы иначе, и дифф раздувается на весь файл.

Дата наблюдения: 2026-09-23.
