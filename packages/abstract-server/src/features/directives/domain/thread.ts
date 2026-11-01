/**
 * Реплика в тред — решение 0039. Дописывается в конец, а не переписывает файл: автор правит тот
 * же файл, пока агент думает, и всё, что выше конца, остаётся как есть. Перед репликой — пустая
 * строка: без неё реплика прилипает к последней строке автора, у которой часто нет перевода
 * строки, и цитата `> [AI]` перестаёт быть цитатой.
 */
export function appendReply(text: string, reply: string): string {
  const trimmed = reply.replace(/\s+$/, "");
  if (trimmed.length === 0) return text;

  const gap =
    text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${gap}${trimmed}\n`;
}
