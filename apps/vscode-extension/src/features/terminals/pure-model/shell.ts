/**
 * The prompt reaches the agent by being typed into a terminal, so a shell reads it first and
 * every shell spells a line break differently. JSON quoting keeps the command on one line, but
 * no shell unescapes it: the agent used to receive the two characters `\n` where a line break
 * was meant, and read the prompt as one run-on paragraph.
 */
export type Shell = "powershell" | "posix" | "unknown";

/** Taken from the default profile's shell path, which is what an unconfigured terminal runs. */
export function shellOf(path: string | undefined): Shell {
  const name = path
    ?.split(/[/\\]/)
    .at(-1)
    ?.replace(/\.exe$/i, "")
    .toLowerCase();
  if (!name) return "unknown";
  if (name === "pwsh" || name === "powershell") return "powershell";
  // fish is left out on purpose: it has neither `$'…'` nor backticks, and guessing wrong is
  // worse than the flat fallback.
  if (["bash", "zsh", "sh", "dash", "ksh"].includes(name)) return "posix";
  return "unknown";
}

/** A running agent submits on every Enter, so a prompt typed into one has to arrive as one line. */
export const singleLine = (prompt: string) =>
  prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

/** Inside `"…"` PowerShell escapes with a backtick, and `` `n `` is the line break. */
const powershell = (value: string) =>
  `"${value
    .replaceAll("`", "``")
    .replaceAll('"', '`"')
    .replaceAll("$", "`$")
    .replaceAll("\n", "`n")}"`;

/** `$'…'` is ANSI-C quoting: bash and zsh unescape `\n` inside it, and nothing else gets through. */
const posix = (value: string) =>
  `$'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n")}'`;

/**
 * Quotes the prompt as a single command line that still carries real line breaks. An unknown
 * shell gets the prompt flattened instead of escaped — one long line reads worse than the
 * original, but it reads, which literal `\n` did not.
 */
export function quotePrompt(prompt: string, shell: Shell): string {
  // Whoever wrote the prompt, it arrives here with the line endings of this machine.
  const value = prompt.replaceAll("\r\n", "\n");
  if (shell === "powershell") return powershell(value);
  if (shell === "posix") return posix(value);
  return JSON.stringify(singleLine(value));
}

/**
 * Обычный аргумент без переносов — например json конфигурации MCP. Кавычки всё равно нужны по
 * правилам оболочки: в PowerShell `\"` не экранирование, а обратная косая перед кавычкой.
 */
export function quoteArg(value: string, shell: Shell): string {
  if (shell === "powershell") return `"${value.replaceAll("`", "``").replaceAll('"', '`"')}"`;
  // В одинарных кавычках posix не знает экранирования: кавычку закрывают, вставляют и снова
  // открывают.
  if (shell === "posix") return `'${value.replaceAll("'", "'\\''")}'`;
  return JSON.stringify(value);
}
