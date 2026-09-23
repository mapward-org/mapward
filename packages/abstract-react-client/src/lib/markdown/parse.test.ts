import { describe, expect, it } from "vitest";
import { inlineMarkdown, parseMarkdown } from "./parse.ts";

describe("inlineMarkdown", () => {
  it("режет строку на код, ссылку и выделения", () => {
    expect(inlineMarkdown("см. `файл` в [доке](mapward://packages/docs), **важно**")).toEqual([
      { kind: "text", text: "см. " },
      { kind: "code", text: "файл" },
      { kind: "text", text: " в " },
      { kind: "link", text: "доке", href: "mapward://packages/docs" },
      { kind: "text", text: ", " },
      { kind: "strong", text: "важно" },
    ]);
  });

  it("оставляет обычный текст одним куском", () => {
    expect(inlineMarkdown("просто строка")).toEqual([{ kind: "text", text: "просто строка" }]);
  });

  it("не трогает звёздочку без пары", () => {
    expect(inlineMarkdown("2 * 2")).toEqual([{ kind: "text", text: "2 * 2" }]);
  });

  it("внутри кода разметки нет", () => {
    expect(inlineMarkdown("`**не жирный**`")).toEqual([{ kind: "code", text: "**не жирный**" }]);
  });
});

describe("parseMarkdown", () => {
  it("читает заголовок, абзац и черту", () => {
    const blocks = parseMarkdown("# Заголовок\n\nстрока\nпродолжение\n\n---\n");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "rule"]);
    expect(blocks[0]).toMatchObject({ level: 1 });
    // Перенос внутри абзаца — перенос в исходнике, а не в выводе.
    expect(blocks[1]).toMatchObject({ spans: [{ text: "строка продолжение" }] });
  });

  it("собирает соседние пункты в один список и считает отступ", () => {
    const blocks = parseMarkdown("- раз\n  - вложенный\n- два\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "list",
      ordered: false,
      items: [{ depth: 0 }, { depth: 1 }, { depth: 0 }],
    });
  });

  it("нумерованный список отличается от маркированного", () => {
    const blocks = parseMarkdown("1. раз\n2. два\n");
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: true });
  });

  it("блок кода забирает строки как есть", () => {
    const blocks = parseMarkdown('```json\n{ "a": 1 }\n```\nхвост\n');
    expect(blocks[0]).toEqual({ kind: "code", text: '{ "a": 1 }', language: "json" });
    expect(blocks[1]).toMatchObject({ kind: "paragraph" });
  });

  it("незакрытый блок кода дочитывается до конца", () => {
    const blocks = parseMarkdown("```\nобрыв вывода\n");
    expect(blocks).toEqual([{ kind: "code", text: "обрыв вывода" }]);
  });

  it("цитата становится своим блоком", () => {
    expect(parseMarkdown("> сказано")).toEqual([
      { kind: "quote", spans: [{ kind: "text", text: "сказано" }] },
    ]);
  });
});
