import type { OpenHow } from "@mapward/component";
import { inlineMarkdown, parseMarkdown, type Block, type Inline } from "./markdown-parse.ts";
import { TAB_TITLE, isObjectLink, linkHover, openHow } from "./marks.ts";

/** Клик по ссылке в тексте; без него ссылки ничего не делают. */
export type OnOpen = ((link: string, how: OpenHow) => void) | undefined;

function Spans(props: { spans: Inline[]; onOpen: OnOpen }) {
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
              onClick={(event) => props.onOpen?.(span.href, openHow(span.href, event))}
              {...(isObjectLink(span.href) ? { title: TAB_TITLE } : {})}
              className={`text-left text-[var(--mw-textLink-foreground)] ${linkHover(span.href)}`}
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

const HEADING_CLASS: Record<number, string> = {
  1: "text-[13px] font-semibold",
  2: "text-[12px] font-semibold",
  3: "text-[11px] font-semibold uppercase opacity-80",
};

function BlockView(props: { block: Block; onOpen: OnOpen }) {
  const { block, onOpen } = props;
  switch (block.kind) {
    case "heading":
      return (
        <div className={`mt-2 mb-1 first:mt-0 ${HEADING_CLASS[block.level] ?? HEADING_CLASS[3]}`}>
          <Spans spans={block.spans} onOpen={onOpen} />
        </div>
      );
    case "paragraph":
      return (
        <p className="mb-1">
          <Spans spans={block.spans} onOpen={onOpen} />
        </p>
      );
    case "quote":
      return (
        <blockquote className="mb-1 border-l-2 border-[var(--mw-textBlockQuote-border,#8884)] pl-2 opacity-80">
          <Spans spans={block.spans} onOpen={onOpen} />
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
                <Spans spans={item.spans} onOpen={onOpen} />
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

/**
 * Markdown карты — решение 0027: заголовки, списки, код, ссылки. `inline` — одной строкой, без
 * абзацев: описание пункта списка или узла дерева. `onOpen` — клик по ссылке внутри текста.
 */
export function Markdown(props: { text: string; inline?: boolean; onOpen?: OnOpen }) {
  if (props.inline) return <Spans spans={inlineMarkdown(props.text)} onOpen={props.onOpen} />;
  return (
    <div className="break-words">
      {parseMarkdown(props.text).map((block, at) => (
        <BlockView key={`${block.kind}:${at}`} block={block} onOpen={props.onOpen} />
      ))}
    </div>
  );
}
