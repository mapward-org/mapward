import type { ActionPermissions } from "@mapward/core";
import type { OutputListener, ProcessResult } from "./index.ts";

/**
 * Разрешения экшона во флаги `claude` — решение 0038. Агента зовут два приложения, и оба зовут
 * `claude`, поэтому перевод лежит здесь один, а процесс заводит каждое у себя.
 *
 * `bypass` снимает вопросы целиком, список — инструменты, которые агенту можно. Метрике не
 * передаётся ничего: она читает, и спрашивать ей нечего.
 */
export function claudeArgs(permissions: ActionPermissions | undefined): string[] {
  if (permissions === undefined) return [];
  if (permissions === "bypass") return ["--dangerously-skip-permissions"];
  return permissions.length === 0 ? [] : ["--allowedTools", ...permissions];
}

/**
 * Через оболочку аргументы уходят одной строкой, и без кавычек `Bash(pnpm build:*)` разъедется
 * на части. Без оболочки процесс получает их массивом, как есть.
 */
export const shellArgs = (args: string[], shell: boolean): string[] =>
  shell ? args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`) : args;

/**
 * Агент с ходом по ходу: `claude` печатает события строками JSON, а не один ответ в конце.
 * Флаги ставятся всегда, есть слушатель или нет — итог после {@link claudeStream} тот же.
 */
export const CLAUDE_STREAM_ARGS = ["-p", "--output-format", "stream-json", "--verbose"];

/** Что сказать об инструменте одной строкой: файл, команда, шаблон — или короткий JSON. */
function toolLine(name: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  const main = ["file_path", "command", "pattern", "path", "url", "description"]
    .map((key) => fields[key])
    .find((value) => typeof value === "string");
  const about = typeof main === "string" ? main : JSON.stringify(input ?? {});
  return `→ ${name} ${about.length > 160 ? `${about.slice(0, 160)}…` : about}`;
}

/**
 * События `claude` в строки для слушателя: «→ Read файл», «→ Bash команда», текст ответа. Итогом
 * отдаётся, как без потока, только последний ответ — значение метрики берётся ровно оттуда же;
 * а в stderr итога уходят строки инструментов, чтобы ход агента остался в логе шага.
 *
 * Перевод лежит здесь, рядом с флагами: агента зовут два приложения, а событий `claude` серверу
 * знать не нужно — для него это такие же строки, как у скрипта.
 */
export function claudeStream(output?: OutputListener): {
  listener: OutputListener;
  finish(result: ProcessResult): ProcessResult;
} {
  let buffer = "";
  let answer: string | undefined;
  let lastText: string | undefined;
  const tools: string[] = [];

  const emit = (line: string) => output?.(`${line}\n`, "err");

  const event = (raw: string) => {
    if (raw.trim() === "") return;
    let parsed: { type?: string; result?: unknown; message?: { content?: unknown } };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      emit(raw);
      return;
    }
    if (parsed.type === "result") {
      if (typeof parsed.result === "string") answer = parsed.result;
      return;
    }
    if (parsed.type !== "assistant" || !Array.isArray(parsed.message?.content)) return;
    for (const block of parsed.message.content as Record<string, unknown>[]) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        lastText = block.text;
        emit(block.text);
      } else if (block.type === "tool_use") {
        const line = toolLine(String(block.name), block.input);
        tools.push(line);
        emit(line);
      }
    }
  };

  const feed = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) event(line);
  };

  return {
    listener: (chunk, stream) => (stream === "out" ? feed(chunk) : output?.(chunk, "err")),
    finish: (result) => {
      event(buffer);
      buffer = "";
      return {
        stdout: answer ?? lastText ?? "",
        stderr: [tools.join("\n"), result.stderr.trim()].filter(Boolean).join("\n"),
      };
    },
  };
}
