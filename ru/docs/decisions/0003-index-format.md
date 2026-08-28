# Формат `_index.json`

```ts
import type { Properties as CSSProperties } from "csstype"

// Минимальный обьект - `object-name/_index.json` содержащий {}
type ObjectIndex = {
  name?: string, // если не заполнить возьмётся имя директории
  props?: Record<string, unknown> // Сюда можно дописать любые данные обьекта, например from to для связи. Они будут доступный в env коллекторов метрик и директив и экшонов
  extends?: string,        // путь к прототипу. относительные считается относительно корня карты может быть ссылкой в интернет
  "preview-size"?: { w: number, h: number },   // размер карточки в клетках карты
  "preview-metrics-layout"?: Layout,         // раскладка метрик на карточке. Если не задано пусто
  "details-metrics-layout"?: Layout,         // раскладка метрик на странице обьекта. Если не задано все стопочкой
  "preview-style"?: CSSProperties, // возможность перезаписать стили карточки превью
}


// areas — имена метрик по клеткам, как grid-template-areas.
// "." — пустая клетка
// style прокидывается в контейнер как есть — своего языка раскладки не заводим.
// Пишем любой css: он не исполняется, максимум человек испортит себе вид.
type Layout = {
  areas: string[][],
  style?: CSSProperties,  // Стиль применяется к  контейнеру метрик 
}
```

areas различается логика на превью и в деталя. 

Если метрики нет в preview area значит на превью его не будет
Если метрики нет в details area значит она добавиться по grid правилу за пределы grid area

**Важно** - `preview-metrics-layout` и `details-metrics-layout` - управляют именно раскладкой метрик а  не всей карточкой. Положение name, actions, directivies задаётся кодом


Пример:

```json
{
  "name": "core",
  "extends": "prototypes/package",
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


## Наследование

Правила мерджа `_index.json` 

`{ ...object.extends, ...object, props: {...object.extends.props, ...object.props } }`

object.extends резолвится рекурсивно. При цикле ошибка

