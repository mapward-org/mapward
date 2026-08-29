# Формат `_index.json`

```ts
import type { Properties as CSSProperties } from "csstype"

// Минимальный обьект - `object-name/_index.json` содержащий {}
type ObjectIndex = {
  name?: string, // если не заполнить возьмётся имя директории
  props?: Record<string, unknown> // Сюда можно дописать любые данные обьекта, например from to для связи. Они будут доступный в env коллекторов метрик и директив и экшонов
  extends?: string,        // mapward:// адрес прототипа, см. решение 0005. Может быть и ссылкой в интернет
  "preview-size"?: { w: number, h: number },   // размер карточки в клетках карты
  "preview-metrics-layout"?: Layout,         // раскладка метрик на карточке. Если не задано пусто
  "details-metrics-layout"?: Layout,         // раскладка метрик на странице обьекта. Если не задано все стопочкой
  "preview-style"?: CSSProperties, // возможность перезаписать стили карточки превью
}


// areas — имена метрик по клеткам, как grid-template-areas.
// "." — пустая клетка
// style прокидывается в контейнер как есть — своего языка раскладки не заводим.
// Пишем любой css: он не исполняется, максимум человек испортит себе вид.
type LayoutVariant = {
  areas: string[][],
  style?: CSSProperties,  // Стиль применяется к  контейнеру метрик 
}

// Одна раскладка на любую ширину, либо словарь: ключ — условие container query
type Layout = LayoutVariant | Record<string, LayoutVariant>
```

areas различается логика на превью и в деталя. 

Если метрики нет в preview area значит на превью его не будет
Если метрики нет в details area значит она добавиться по grid правилу за пределы grid area

**Важно** - `preview-metrics-layout` и `details-metrics-layout` - управляют именно раскладкой метрик а  не всей карточкой. Положение name, actions, directivies задаётся кодом

## Раскладка под ширину контейнера

Одна и та же карточка живёт в сайдбаре и в табе, ширина отличается в разы. Поэтому
раскладок можно задать несколько — по ширине контейнера, а не окна.

```json
"preview-metrics-layout": {
  "max-width: 200px": { "areas": [["code"], ["tests"]] },
  "max-width: 500px": { "areas": [["code", "tests"]] }
}
```

Адаптивна раскладка целиком, а не только `areas`: `style` задаёт `gridTemplateRows` под
конкретный набор `areas`, врозь они разъезжаются.

Ключ уходит в css как есть — `@container (max-width: 200px)`. Своего языка условий не
заводим, доступны любые container queries. Перекрытие разруливает каскад: при ширине 150px
подходят оба ключа примера, побеждает последний. Значит **порядок ключей значим**.

Формы различаются по `areas` на верхнем уровне: есть — одна раскладка, нет — словарь.


Пример:

```json
{
  "name": "core",
  "extends": "mapward://prototypes/package",
  "preview-size": { "w": 2, "h": 1 },
  "preview-metrics-layout": {
    "areas": [["code", "tests"]]
  },
  "details-metrics-layout": {
    "areas": [
      ["docs", "docs", "version"],
      ["code", "tests", "lint"],
      ["public-api", "public-api", "public-api"]
    ],
    "style": {
      "gridTemplateRows": "auto auto 1fr",
      "gap": "8px"
    }
  }
}
```


## Подстановки

Строки `_index.json` могут содержать подстановки, см. решение [0006](0006-substitution.md).
Особых полей нет, `props` обычные данные

## Наследование

Правила мерджа `_index.json` 

`{ ...object.extends, ...object, props: {...object.extends.props, ...object.props } }`

object.extends резолвится рекурсивно. При цикле ошибка

