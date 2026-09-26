import { expect, test } from "vitest";
import { claudeStream } from "./agent-args.ts";

const line = (event: unknown) => `${JSON.stringify(event)}\n`;

test("claude events become lines as they come, and the result is only the last answer", () => {
  const seen: [string, string][] = [];
  const stream = claudeStream((chunk, kind) => seen.push([chunk, kind]));

  const events =
    line({ type: "system", subtype: "init" }) +
    line({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } }] },
    }) +
    line({ type: "assistant", message: { content: [{ type: "text", text: "готово" }] } }) +
    line({ type: "result", subtype: "success", result: '{"ok":true}' });
  // Событие режется на границе кусков — строка собирается целиком, а не бьётся.
  stream.listener(events.slice(0, 50), "out");
  stream.listener(events.slice(50), "out");
  stream.listener("warning\n", "err");

  expect(seen).toEqual([
    ["→ Read src/a.ts\n", "err"],
    ["готово\n", "err"],
    ["warning\n", "err"],
  ]);
  expect(stream.finish({ stdout: events, stderr: "warning\n" })).toEqual({
    stdout: '{"ok":true}',
    stderr: "→ Read src/a.ts\nwarning",
  });
});

test("without a result event the answer is the last text, and non-JSON lines pass through", () => {
  const seen: string[] = [];
  const stream = claudeStream((chunk) => seen.push(chunk));
  stream.listener("не json\n", "out");
  stream.listener(
    line({ type: "assistant", message: { content: [{ type: "text", text: "а" }] } }),
    "out",
  );

  expect(seen).toEqual(["не json\n", "а\n"]);
  expect(stream.finish({ stdout: "", stderr: "" }).stdout).toBe("а");
});
