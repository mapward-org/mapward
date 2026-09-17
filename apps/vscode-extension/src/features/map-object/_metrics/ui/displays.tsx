import type { DisplayData, StatusMark } from "../pure-model/display.ts";
import { placeholder } from "../pure-model/display.ts";
import { FileTree } from "./file-tree.tsx";
import { StatusDot } from "./status-dot.tsx";
import { ChildrenMapView } from "../../_children-map/compose/children-map.tsx";

function Link(props: {
  node: StatusMark & { label?: string; link?: string };
  onOpen: (link: string) => void;
}) {
  const { node } = props;
  const text = node.label ?? node.link ?? "—";
  const body = node.link ? (
    <button
      type="button"
      onClick={() => props.onOpen(node.link ?? "")}
      className="truncate text-left text-[var(--vscode-textLink-foreground)] hover:underline"
    >
      {text}
    </button>
  ) : (
    <span className="truncate">{text}</span>
  );

  return (
    <span className="flex items-center gap-1">
      <StatusDot mark={node} />
      {body}
    </span>
  );
}

export function Display(props: {
  data: DisplayData;
  /** Whether the metric has run at all: a cell that never ran is not a cell with bad data. */
  collected: boolean;
  empty?: string;
  mapPath: string;
  address: string;
  onOpen: (link: string) => void;
}) {
  const { data } = props;

  const note = placeholder(data, props.collected, props.empty);
  if (note) return <span className="opacity-60">{note}</span>;

  switch (data.kind) {
    case "text":
      return <span>{data.text}</span>;
    case "link":
      return <Link node={data.node} onOpen={props.onOpen} />;
    case "status":
      return (
        <span className="flex items-center gap-1">
          <StatusDot mark={{ status: data.ok ? "success" : "fail" }} />
          <span>{data.summary ?? (data.ok ? "ок" : "не ок")}</span>
        </span>
      );
    case "list":
      return (
        <ul>
          {data.items.map((item, index) => (
            <li key={`${item.label ?? index}`} className="mb-1">
              <Link node={item} onOpen={props.onOpen} />
              {item.description && (
                <div className="pl-3 text-[11px] opacity-70">{item.description}</div>
              )}
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
