const pad = (value: number) => String(value).padStart(2, "0");

/** Имя директивы — время и суть: список сортируется сам, а диффом видно, какая изменилась. */
export function directiveName(title: string, now: Date): string {
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    `${pad(now.getHours())}${pad(now.getMinutes())}`,
  ].join("-");

  const slug = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-zа-я0-9]+/gi, "-")
    .replaceAll(/^-|-$/g, "");

  return `${stamp}-${slug}.md`;
}

/**
 * Директива зовётся именем файла, а не путём: сложенный из чужих кусков путь увёл бы удаление
 * за пределы папки объекта.
 */
export const isDirectiveName = (name: string) =>
  name.endsWith(".md") && !name.includes("..") && !/[\\/]/.test(name);
