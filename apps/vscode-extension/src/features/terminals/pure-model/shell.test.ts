import { expect, test } from "vitest";
import { quoteArg, quotePrompt, shellOf, singleLine } from "./shell.ts";

/**
 * Escaping is the kind of rule a review reads past: every case below is a character the agent
 * received wrong at some point, the line break above all.
 */

test("the default profile's shell is recognised by its file name", () => {
  expect(shellOf("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("powershell");
  expect(shellOf("C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(
    "powershell",
  );
  expect(shellOf("/bin/zsh")).toBe("posix");
  expect(shellOf("/usr/bin/fish")).toBe("unknown");
  expect(shellOf(undefined)).toBe("unknown");
});

test("PowerShell gets its backtick escapes, and a line break stays a line break", () => {
  expect(quotePrompt('a\nb "c" $d `e', "powershell")).toBe('"a`nb `"c`" `$d ``e"');
});

test("bash and zsh get ANSI-C quoting", () => {
  expect(quotePrompt("a\nb 'c' \\d", "posix")).toBe("$'a\\nb \\'c\\' \\\\d'");
});

test("an unknown shell is handed one flat line rather than an escape it cannot read", () => {
  expect(quotePrompt("a\n\nb", "unknown")).toBe('"a b"');
});

test("a warm session gets the prompt on one line", () => {
  expect(singleLine("Директива: x\n\n— первое\n— второе")).toBe("Директива: x — первое — второе");
});

test("line endings of this machine do not reach the agent", () => {
  expect(quotePrompt("a\r\nb", "posix")).toBe("$'a\\nb'");
});

/**
 * Конфиг MCP уезжает в командную строку рядом с промптом — решение 0009. В PowerShell `\"`
 * кавычку не экранирует, поэтому json нельзя просто прогнать через `JSON.stringify`.
 */
test("json argument is quoted the way the shell wants", () => {
  const config = '{"mcpServers":{"mapward":{"url":"http://127.0.0.1:1/mcp"}}}';

  expect(quoteArg(config, "powershell")).toBe(
    '"{`"mcpServers`":{`"mapward`":{`"url`":`"http://127.0.0.1:1/mcp`"}}}"',
  );
  expect(quoteArg(config, "posix")).toBe(`'${config}'`);
  expect(quoteArg("it's", "posix")).toBe("'it'\\''s'");
});
