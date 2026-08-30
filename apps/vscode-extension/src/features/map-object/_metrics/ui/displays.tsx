import type { DisplayData } from "../pure-model/display.ts";
import { FileTree } from "./file-tree.tsx";
import { ChildrenMapView } from "../../_children-map/compose/children-map.tsx";

function Link(props: { label?: string; link?: string; onOpen: (link: string) => void }) {
  const text = props.label ?? props.link ?? "—";
  if (!props.link) return <span>{text}</span>;
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.link ?? "")}
      className="text-left text-[var(--vscode-textLink-foreground)] hover:underline"
    >
      {text}
    </button>
  );
}

export function Display(props: {
  data: DisplayData;
  mapPath: string;
  address: string;
  onOpen: (link: string) => void;
}) {
  const { data } = props;

  switch (data.kind) {
    case "text":
      return <span>{data.text}</span>;
    case "link":
      return <Link label={data.node.label} link={data.node.link} onOpen={props.onOpen} />;
    case "status":
      return (
        <span className="flex items-center gap-1">
          <span className={data.ok ? "text-green-500" : "text-red-500"}>●</span>
          <span>{data.summary ?? (data.ok ? "ок" : "не ок")}</span>
        </span>
      );
    case "list":
      return (
        <ul>
          {data.items.map((item, index) => (
            <li key={`${item.label ?? index}`}>
              <Link label={item.label} link={item.link} onOpen={props.onOpen} />
            </li>
          ))}
        </ul>
      );
    case "tree":
      return <FileTree nodes={data.children} onOpen={props.onOpen} />;
    case "map":
      return (
        <ChildrenMapView
          map={{ nodes: data.nodes, relations: data.relations }}
          mapPath={props.mapPath}
          address={props.address}
          onOpen={props.onOpen}
        />
      );
    default:
      return (
        <span className="text-[var(--vscode-errorForeground)]" title={data.reason}>
          данные не той формы: {data.reason}
        </span>
      );
  }
}
