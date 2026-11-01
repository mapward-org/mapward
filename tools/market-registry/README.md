# mapward market

Реестр маркетплейса [mapward](https://github.com/mapward-org/mapward): плагины и куски карты,
которые выложили другие.

> **За безопасность того, что здесь перечислено, реестр ответственности не несёт.** Каждая строка —
> ссылка на чужой публичный репозиторий. Прочитайте код до того, как его запускать: `market_read`
> в MCP или `mapward market read <имя> [файл]` в терминале. Плагин из реестра ставится недоверенным
> — до первого запуска редактор спросит «Доверять?».

## Как этим пользоваться

Агенту — инструменты MCP mapward: `market_search`, `market_read`, `market_add`, `market_diff`.
Человеку — те же команды в CLI:

```sh
npx @mapward/cli market search граф зависимостей
npx @mapward/cli market read deps-graph index.ts
npx @mapward/cli market add deps-graph
```

Подробно — раздел `market` в `read_docs` mapward.

## Индексы

`plugins.json` — плагины, `maps.json` — куски карты. Строка:

```json
{
  "name": "deps-graph",
  "description": "граф зависимостей пакетов монорепы: метрика-дерево и холст",
  "repo": "author/mapward-deps-graph",
  "branch": "main"
}
```

- `name` — строчные латинские, цифры и дефис; оно же папка `_plugins/<имя>`;
- `description` — по нему ищут: что даёт и на каком проекте;
- `repo` — публичный репозиторий на GitHub, `владелец/имя` или ссылка;
- `branch` — ветка, по умолчанию `main`. Свою ветку автор правит без нового pull request'а.

В репозитории — одна вещь в корне: плагин (`index.ts` с `definePlugin`, README для агентов) или
кусок карты (папки объектов с `_index.json`, и `market.json` со списком нужных плагинов из
реестра: `{ "plugins": ["имя"] }`).

## Как добавить

Pull request, который меняет только `plugins.json` или `maps.json`:

```sh
gh repo fork mapward-org/market --clone
# добавить строку в plugins.json или maps.json
gh pr create --title "plugin: deps-graph" --body "…"
```

Бот проверяет форму, а не содержание: строка разбирается, присланное ставится в пустую карту
(`mapward market add --trust`) и запускается — плагин `mapward plugin check`, кусок карты —
`check` каждого объекта: метрики собираются и зовутся пробно. Зелёное — pull request принят,
красное — комментарий с выводом проверки. Удаление строк и правки чего-то, кроме индексов,
принимает человек.

## Как устроена проверка

- `check.yml` — на pull request, без прав на запись и без секретов: она запускает чужой код.
  Скрипт `scripts/check.mjs` берётся из `main`, а не из pull request'а, индексы — из pull
  request'а. `mapward` — из npm, `@mapward/cli`.
- `merge.yml` — после проверки, с правами на запись; чужой код здесь не запускается. Комментирует
  pull request ответом проверки и принимает его, только если проверка зелёная, коммит тот же, что
  проверяли, и pull request трогает одни индексы.
