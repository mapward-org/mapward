import { useNavigation, usePlugin, useStream } from "@mapward/component";
import type { MetricProps } from "@mapward/component";
import type files from "../../../../_plugins/files/index.ts";
import { FileTree } from "../../../../_plugins/views/bricks/file-tree.tsx";

/**
 * Метрика-компонент: дерево приходит потоком из плагина, клик открывает файл, как любая ссылка
 * карты, — плагином `navigation`.
 * Рамки нет — что показать, пока дерева нет, решает сама метрика.
 */
export default function View({ params }: MetricProps<{ path: string }>) {
  const plugin = usePlugin<typeof files>("../../../../_plugins/files");
  const tree = useStream(["files.tree", params.path], () => plugin.tree({ path: params.path }));
  const navigate = useNavigation();

  if (tree.status === "connecting") {
    return <div className="text-[var(--mw-descriptionForeground)]">читаю файлы…</div>;
  }
  if (tree.status === "error") {
    return <div className="text-[var(--mw-errorForeground)]">{tree.error}</div>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[12px] font-semibold">Файлы (плагин)</div>
      <FileTree items={tree.last?.children ?? []} onClick={navigate} />
    </div>
  );
}
