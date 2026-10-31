import { definePlugin } from "@mapward/plugin";
import { Type } from "typebox";

/**
 * Готовые виды метрики — то, что раньше было дисплеями пайплайна: `list.tsx`, `tree.tsx`,
 * `link.tsx`, `status.tsx`, `text.tsx`, `markdown.tsx`. Метрика называет вид своим `component`, а
 * данные — в `params`: `source` — метод плагина, который даёт их потоком, или `data` — статика.
 *
 * ```json
 * {
 *   "label": "Решения",
 *   "component": "../../_plugins/views/tree.tsx",
 *   "params": {
 *     "source": {
 *       "plugin": "${{ mapward:// }}/_plugins/files",
 *       "method": "tree",
 *       "params": { "path": "${{ mapward://@ }}/ru/docs/decisions", "git": true }
 *     },
 *     "empty": "решений нет"
 *   }
 * }
 * ```
 *
 * Метрику по виду проще писать шаблоном: `{ "label": "Решения", "plugin": "_plugins/views",
 * "template": "tree", "params": { "source": … } }` — платформа развернёт её в `component` и `agent`
 * (агенту — тот же `source`) и проверит `params` схемой.
 *
 * Виды собраны из кирпичей `bricks/` — список, дерево, markdown, точка статуса, сетка раскладки,
 * кнопка экшона. Их берут и свои компоненты карты, относительным импортом
 * (`../../_plugins/views/bricks/list.tsx`): кирпичи чистые, с платформой говорят только через
 * `@mapward/component`.
 *
 * Методов у плагина нет: виды — компоненты, процесс им не нужен. Это код проекта: правь под себя.
 */
/** Параметры всех видов — `ViewParams` из `source.ts` схемой: по ней платформа проверяет запись. */
const VIEW_PARAMS = Type.Object(
  {
    source: Type.Optional(
      Type.Object(
        {
          plugin: Type.String({ description: "папка плагина: ${{ mapward:// }}/_plugins/…" }),
          method: Type.String(),
          params: Type.Optional(Type.Unknown()),
        },
        { description: "метод плагина, который даёт данные потоком" },
      ),
    ),
    data: Type.Optional(Type.Unknown({ description: "статика вместо источника" })),
    empty: Type.Optional(Type.String({ description: "что сказать, когда показывать нечего" })),
    refresh: Type.Optional(
      Type.String({ description: "изменяющий метод источника для кнопки «обновить»" }),
    ),
    collapsed: Type.Optional(Type.Boolean({ description: "метрика приходит свёрнутой" })),
  },
  { additionalProperties: false },
);

/** Вид по имени: компонент, схема и агент — тот же источник, что у вида. */
const view = (component: string, description: string) => ({
  component,
  description,
  params: VIEW_PARAMS,
  agent: { param: "source" },
});

export default definePlugin({
  description:
    "Готовые виды метрики (list, tree, link, status, text, markdown): данные — params.source (метод плагина) или params.data",
  templates: {
    list: view("list.tsx", "список строк или пунктов"),
    tree: view("tree.tsx", "дерево: узлы с детьми, ссылками и буквами git"),
    link: view("link.tsx", "одна ссылка или адрес"),
    status: view("status.tsx", "статус: ok, предупреждение, ошибка с текстом"),
    text: view("text.tsx", "строка текста"),
    markdown: view("markdown.tsx", "markdown"),
  },
  methods: {},
});
