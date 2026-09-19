import type { ServerPorts } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";

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
 * Пустая директива — приглашение писать: файл создаётся и отдаётся приложению, а открыть его
 * в редакторе умеет только хост.
 */
export async function createDirective(
  ports: ServerPorts,
  params: { objectPath: string; title: string },
): Promise<{ path: string }> {
  const path = join(params.objectPath, "_directives", directiveName(params.title, new Date()));
  await ports.files.write(path, "\n## \n\n");
  return { path };
}
