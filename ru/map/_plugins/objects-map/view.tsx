import { ObjectCard, useNavigation, usePlugin, useStream } from "@mapward/component";
import type { DisplayObject, MetricProps } from "@mapward/component";
import { Canvas } from "./canvas/canvas.tsx";
import { settle } from "./canvas/settle.ts";
import type { CanvasPort } from "./canvas/ports.ts";
import type plugin from "./index.ts";

/**
 * Холст карты — метрика-компонент этого плагина. Вьюха приходит потоком и пересчитывается сама,
 * когда меняется карта или `map-state.json`; правка — метод `edit` того же плагина. Что показать,
 * говорят `params` метрики: `show`, `prototypes`, `exclude`, `expand`, `style`, `palette`,
 * `placeObjects`, `placeRelations`. Переход к объекту — как любая ссылка карты, `useNavigation`;
 * карточка узла с полным превью — кирпич `ObjectCard`. Сам холст — `canvas/`, код этого плагина.
 */
export default function View({ params, metric, object }: MetricProps) {
  const objectsMap = usePlugin<typeof plugin>(".");
  const navigate = useNavigation();
  const view = useStream(["objects-map.view", metric.address, params], () =>
    objectsMap.view({ view: metric.address, config: params }),
  );

  if (view.status === "error") {
    return <div className="text-[var(--mw-errorForeground)]">{view.error}</div>;
  }
  if (!view.last) {
    // `data-loading` — заглушка загрузки: скриншот метрики ждёт, пока таких не останется.
    return (
      <div data-loading="" className="text-[var(--mw-descriptionForeground)]">
        рисую вьюху…
      </div>
    );
  }
  const port: CanvasPort = {
    mapPath: mapRoot(object),
    edit: (ops) => settle(objectsMap.edit({ view: metric.address, ops })),
    undo: (id) => settle(objectsMap.undo({ id })),
    redo: (id) => settle(objectsMap.redo({ id })),
    open: (link) => navigate(link),
    // Хост без табов открывает ссылку как обычно: ctrl + клик там просто переход.
    openTab: (link) => navigate(link, { tab: true }),
    Card: ObjectCard,
  };
  return <Canvas map={view.last} port={port} />;
}

/**
 * Папка карты — по папке объекта метрики и его адресу: адрес — это путь папки от корня карты.
 * Холсту она нужна, чтобы копия с одной карты не вставлялась в другую.
 */
function mapRoot(object: DisplayObject): string {
  const path = object.path.replaceAll("\\", "/");
  const inside = object.address.replace(/^mapward:\/\//, "");
  return inside && path.endsWith(`/${inside}`) ? path.slice(0, -inside.length - 1) : path;
}
