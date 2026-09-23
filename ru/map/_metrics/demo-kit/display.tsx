import type { DisplayProps, TreeItem } from "@mapward/display";
import { FileTree, Link, List, Markdown, StatusDot } from "@mapward/display";
import type { Data } from "./display.data";

/**
 * Тестовый дисплей-компонент (решение 0037): каждый кусочек набора по разу. Схема ссылается на
 * себя через `$ref` — такой тип генератор не выводит и честно пишет `unknown`, отсюда
 * приведение у дерева.
 */
export default function Display({ data, object, metric }: DisplayProps<Data>) {
  return (
    <div className="flex flex-col gap-3">
      <Markdown text={data.note} />

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
        <Link item={{ label: "объект, на котором висит метрика", link: object.address }} />
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="m-0 text-[11px] uppercase opacity-60">List</h4>
        <List items={data.items} />
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="m-0 text-[11px] uppercase opacity-60">FileTree</h4>
        <FileTree items={data.tree as TreeItem[]} />
      </section>

      <Markdown inline text={`метрика \`${metric.key}\`, объект «${object.name}»`} />
    </div>
  );
}
