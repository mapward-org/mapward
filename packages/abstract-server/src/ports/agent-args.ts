import type { ActionPermissions } from "@mapward/core";

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
