import type { MetricProps } from "@mapward/component";
import { useNavigation } from "@mapward/component";
import { ActionButton } from "../../_plugins/views/bricks/action-button.tsx";
import { FileTree } from "../../_plugins/views/bricks/file-tree.tsx";
import { Link } from "../../_plugins/views/bricks/link.tsx";
import { List } from "../../_plugins/views/bricks/list.tsx";
import { Markdown } from "../../_plugins/views/bricks/markdown.tsx";
import { StatusDot } from "../../_plugins/views/bricks/status-dot.tsx";
import type { LinkItem, TreeItem } from "../../_plugins/views/bricks/types.ts";

type Params = { note: string; items: LinkItem[]; tree: TreeItem[] };

/**
 * Тестовая метрика-компонент (решение 0037): каждый кирпич плагина `views` по разу. Кирпичи —
 * относительным импортом из `_plugins/views/bricks`; данные — статикой в `params`: плагин здесь
 * не нужен.
 */
export default function Kit({ params: data, object, metric }: MetricProps<Params>) {
  // Кирпичи чистые: ссылки открывает компонент, как любая ссылка карты.
  const navigate = useNavigation();
  return (
    <div className="flex flex-col gap-3">
      <Markdown text={data.note} onOpen={navigate} />

      <section className="flex flex-col gap-1">
        <h4 className="m-0 text-[11px] uppercase opacity-60">StatusDot и Link</h4>
        <div className="flex flex-wrap gap-3">
          {data.items.map((item) => (
            <span key={item.label} className="flex items-center gap-1">
              <StatusDot
                {...(item.status === undefined ? {} : { status: item.status })}
                {...(item.color === undefined ? {} : { color: item.color })}
              />
              {item.label}
            </span>
          ))}
        </div>
        <Link
          item={{ label: "объект, на котором висит метрика", link: object.address }}
          onClick={navigate}
        />
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="m-0 text-[11px] uppercase opacity-60">List</h4>
        <List items={data.items} onClick={navigate} />
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="m-0 text-[11px] uppercase opacity-60">FileTree</h4>
        <FileTree items={data.tree} onClick={navigate} />
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="m-0 text-[11px] uppercase opacity-60">ActionButton</h4>
        <ActionButton action="reveal" inputs={{ path: object.path }} label="показать карту в проводнике" />
      </section>

      <Markdown inline text={`метрика \`${metric.key}\`, объект «${object.name}»`} />
    </div>
  );
}
