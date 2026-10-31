import { isAddress, parseAddress } from "@mapward/core";
import { join } from "../../../lib/path.ts";

/**
 * Файл раскладки по её ссылке. Адрес `mapward://` ведёт в папку карты (`@` — в проект, `~` — в
 * папку объекта): сегменты адреса — это и есть папки. Поля (`#…`) у файла нет — это не файл.
 */
export function layoutFile(
  layout: string,
  places: { mapPath: string; basePath: string; objectPath: string },
): string | undefined {
  if (!isAddress(layout)) return layout;
  const address = parseAddress(layout);
  if (!address || address.field !== undefined || address.path.length === 0) return undefined;
  const root =
    address.scope === "base"
      ? places.basePath
      : address.scope === "self"
        ? places.objectPath
        : places.mapPath;
  return join(root, ...address.path);
}
