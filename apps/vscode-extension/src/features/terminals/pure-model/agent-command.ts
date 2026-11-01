import { quoteArg, quotePrompt, type Shell } from "./shell.ts";

/**
 * Сессия агента директивы: идентификатор и есть ли уже такой разговор на диске. Есть — агент
 * его продолжает (`--resume`), нет — начинает новый под тем же идентификатором (`--session-id`):
 * так следующий запуск найдёт его, даже если в этот раз до первого сообщения не дошло.
 */
export type AgentSession = { id: string; resume: boolean };

/**
 * Строка запуска агента. Промпт идёт позиционным аргументом после флага сессии, а `--mcp-config`
 * — последним: он принимает несколько значений подряд и съел бы промпт, стоящий за ним.
 */
export function agentCommand(params: {
  shell: Shell;
  prompt?: string;
  session?: AgentSession;
  mcpConfig?: string;
}): string {
  const parts = ["claude"];
  if (params.session) {
    parts.push(params.session.resume ? "--resume" : "--session-id", params.session.id);
  }
  if (params.prompt !== undefined && params.prompt !== "") {
    parts.push(quotePrompt(params.prompt, params.shell));
  }
  if (params.mcpConfig !== undefined) {
    parts.push("--mcp-config", quoteArg(params.mcpConfig, params.shell));
  }
  return parts.join(" ");
}
