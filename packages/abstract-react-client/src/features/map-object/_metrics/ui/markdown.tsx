import type { Block, Inline } from "../pure-model/markdown.ts";
import { inlineMarkdown, parseMarkdown } from "../pure-model/markdown.ts";

/**
 * Разметка в метрике — решение 0027. Ссылки идут через тот же `onOpen`, что и всё остальное в
 * дисплеях: куда вести, решает схема адреса (0005), а не то, что ссылка пришла из markdown.
 */

function Spans(props: { spans: Inline[]; onOpen: (link: string) => void }) {
  return (
    <>
      {props.spans.map((span, at) => {
        const key = `${span.kind}:${at}`;
        if (span.kind === "code") {
          return (
            <code
              key={key}
              className="rounded-sm bg-[var(--mw-textBlockQuote-background,#8881)] px-1 font-mono text-[11px]"
            >
              {span.text}
            </code>
          );
        }
        if (span.kind === "strong") return <strong key={key}>{span.text}</strong>;
        if (span.kind === "em") return <em key={key}>{span.text}</em>;
        if (span.kind === "link") {
          return (
            <button
              key={key}
              type="button"
              onClick={() => props.onOpen(span.href)}
              className="text-left text-[var(--mw-textLink-foreground)] hover:underline"
            >
              {span.text || span.href}
            </button>
          );
        }
        return <span key={key}>{span.text}</span>;
      })}
    </>
  );
}

/** Строка с разметкой без блоков: описание элемента списка или узла дерева. */
export function MarkdownLine(props: { text: string; onOpen: (link: string) => void }) {
  return <Spans spans={inlineMarkdown(props.text)} onOpen={props.onOpen} />;
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-[13px] font-semibold",
  2: "text-[12px] font-semibold",
  3: "text-[11px] font-semibold uppercase opacity-80",
};

function BlockView(props: { block: Block; onOpen: (link: string) => void }) {
  const { block } = props;

  switch (block.kind) {
    case "heading":
      return (
        <div className={`mt-2 mb-1 first:mt-0 ${HEADING_CLASS[block.level] ?? HEADING_CLASS[3]}`}>
          <Spans spans={block.spans} onOpen={props.onOpen} />
        </div>
      );
    case "paragraph":
      return (
        <p className="mb-1">
          <Spans spans={block.spans} onOpen={props.onOpen} />
        </p>
      );
    case "quote":
      return (
        <blockquote className="mb-1 border-l-2 border-[var(--mw-textBlockQuote-border,#8884)] pl-2 opacity-80">
          <Spans spans={block.spans} onOpen={props.onOpen} />
        </blockquote>
      );
    case "list":
      return (
        <ul className="mb-1">
          {block.items.map((item, at) => (
            <li
              key={`${at}`}
              style={{ paddingLeft: `${item.depth * 10}px` }}
              className="flex gap-1"
            >
              <span className="shrink-0 opacity-60">{block.ordered ? `${at + 1}.` : "•"}</span>
              <span className="min-w-0">
                <Spans spans={item.spans} onOpen={props.onOpen} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre className="mb-1 overflow-x-auto rounded-sm bg-[var(--mw-textBlockQuote-background,#8881)] p-1 font-mono text-[11px]">
          {block.text}
        </pre>
      );
    default:
      return <hr className="my-2 border-[var(--mw-panel-border,#8884)]" />;
  }
}

export function Markdown(props: { text: string; onOpen: (link: string) => void }) {
  return (
    <div className="break-words">
      {parseMarkdown(props.text).map((block, at) => (
        <BlockView key={`${block.kind}:${at}`} block={block} onOpen={props.onOpen} />
      ))}
    </div>
  );
}
