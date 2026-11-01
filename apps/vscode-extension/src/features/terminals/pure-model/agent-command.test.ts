import { expect, test } from "vitest";
import { agentCommand } from "./agent-command.ts";

test("a new directive session is started under its own id, the prompt before the MCP config", () => {
  expect(
    agentCommand({
      shell: "posix",
      prompt: "hi",
      session: { id: "abc", resume: false },
      mcpConfig: "{}",
    }),
  ).toBe("claude --session-id abc $'hi' --mcp-config '{}'");
});

test("a session already on disk is resumed, and without a prompt nothing is sent to it", () => {
  expect(agentCommand({ shell: "powershell", session: { id: "abc", resume: true } })).toBe(
    "claude --resume abc",
  );
});

test("a terminal outside a directive has no session flag at all", () => {
  expect(agentCommand({ shell: "powershell", prompt: "hi" })).toBe('claude "hi"');
});
