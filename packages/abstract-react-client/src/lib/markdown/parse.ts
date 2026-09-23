/**
 * Разбор markdown — решение 0027.
 *
 * Свой маленький разбор, а не библиотека: клиент рисует карту в любом хосте, и зависимость
 * ради жирного и ссылок пришлось бы тащить в каждый. Поэтому синтаксис назван списком, а не
 * «markdown вообще»: заголовки, абзацы, списки, цитаты, блоки кода, черта; в строке — код,
 * ссылки, жирный и курсив.
 *
 * Чего здесь нет: таблиц, картинок, сносок, html. Строка таблицы покажется абзацем — текст
 * не пропадает, а форма у него не та; это цена, которую решение называет вслух.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; spans: Inline[] }
  | { kind: "paragraph"; spans: Inline[] }
  | { kind: "quote"; spans: Inline[] }
  | { kind: "list"; ordered: boolean; items: { depth: number; spans: Inline[] }[] }
  | { kind: "code"; text: string; language?: string }
  | { kind: "rule" };

/**
 * Разбор строки. Порядок ветвлений и есть приоритет: код съедает всё внутри себя, ссылка
 * читается целиком, и только потом остаются выделения.
 *
 * Вложенности нет нарочно: `**[текст](ссылка)**` разберётся ссылкой без жирного. Полный разбор
 * с вложенностью — это уже парсер markdown, а нужен он в описании метрики примерно никогда.
 */
const TOKEN =
  /(`[^`]+`)|(\[[^\]\n]*\]\([^)\s]+\))|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\n]+_)/;

export function inlineMarkdown(source: string): Inline[] {
  const spans: Inline[] = [];
  let rest = source;

  while (rest.length > 0) {
    const found = TOKEN.exec(rest);
    if (!found || found.index === undefined) break;

    if (found.index > 0) spans.push({ kind: "text", text: rest.slice(0, found.index) });
    const token = found[0];

    if (token.startsWith("`")) {
      spans.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      spans.push({
        kind: "link",
        text: token.slice(1, split),
        href: token.slice(split + 2, -1),
      });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      spans.push({ kind: "strong", text: token.slice(2, -2) });
    } else {
      spans.push({ kind: "em", text: token.slice(1, -1) });
    }

    rest = rest.slice(found.index + token.length);
  }

  if (rest.length > 0) spans.push({ kind: "text", text: rest });
  return spans;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)\d+[.)]\s+(.*)$/;
const FENCE = /^```\s*(\S*)\s*$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^>\s?(.*)$/;

/** Отступ в уровень: два пробела на ступень, как пишут руками. Табуляция считается за два. */
const depthOf = (indent: string): number => Math.floor(indent.replaceAll("\t", "  ").length / 2);

/**
 * Разбор текста в блоки. Строки склеиваются в абзац, пока не встретится пустая или начало
 * другого блока: перенос внутри абзаца — это перенос в исходнике, а не в выводе.
 */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: inlineMarkdown(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? "";

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      // Незакрытый забор дочитывается до конца текста: оборванный вывод — обычное дело, и
      // показать его кодом честнее, чем рассыпать остаток документа на абзацы.
      for (at++; at < lines.length && !(lines[at] ?? "").startsWith("```"); at++) {
        body.push(lines[at] ?? "");
      }
      // Пустые строки в хвосте — это перенос в конце файла, а не часть вывода: они дали бы
      // блоку кода пустую полосу внизу.
      while ((body.at(-1) ?? "x").trim() === "") body.pop();
      blocks.push({
        kind: "code",
        text: body.join("\n"),
        ...(fence[1] ? { language: fence[1] } : {}),
      });
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        spans: inlineMarkdown(heading[2] ?? ""),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      blocks.push({ kind: "quote", spans: inlineMarkdown(quote[1] ?? "") });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBER.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const ordered = numbered !== null;
      const last = blocks.at(-1);
      // Соседние пункты одного вида — один список: иначе каждый пункт получил бы свой отступ.
      const list =
        last?.kind === "list" && last.ordered === ordered
          ? last
          : ({ kind: "list", ordered, items: [] } as Block & { kind: "list" });
      if (list !== last) blocks.push(list);
      list.items.push({ depth: depthOf(item[1] ?? ""), spans: inlineMarkdown(item[2] ?? "") });
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}
