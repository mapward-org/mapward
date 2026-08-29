import type { DisplayData, TreeNode } from "../pure-model/display.ts";

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

function Branch(props: { nodes: TreeNode[]; onOpen: (link: string) => void; depth: number }) {
  return (
    <ul className={props.depth === 0 ? "" : "pl-3"}>
      {props.nodes.map((node, index) => (
        <li key={`${node.label ?? index}`}>
          <Link label={node.label} link={node.link} onOpen={props.onOpen} />
          {node.children && node.children.length > 0 && (
            <Branch nodes={node.children} onOpen={props.onOpen} depth={props.depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function Display(props: { data: DisplayData; onOpen: (link: string) => void }) {
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
      return <Branch nodes={data.children} onOpen={props.onOpen} depth={0} />;
    default:
      return (
        <span className="text-[var(--vscode-errorForeground)]" title={data.reason}>
          данные не той формы: {data.reason}
        </span>
      );
  }
}
