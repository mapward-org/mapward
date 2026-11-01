/**
 * Реестр маркетплейса — публичный репозиторий с двумя индексами: плагины и куски карты. Строка
 * индекса — имя, описание для поиска, репозиторий автора и ветка. Ветка, а не коммит: иначе
 * каждое изменение автора пришлось бы принимать в реестр заново. Коммит запоминается у того, кто
 * поставил, — в записи «откуда» рядом с копией.
 */

export type MarketKind = "plugin" | "map";

export type MarketEntry = {
  kind: MarketKind;
  name: string;
  description: string;
  /** `владелец/репозиторий` на GitHub. */
  repo: string;
  branch: string;
};

/** Где реестр по умолчанию: прямые ссылки на содержимое ветки `main` его репозитория. */
export const DEFAULT_REGISTRY = "https://raw.githubusercontent.com/mapward-org/market/main";

/** Переменная окружения, которой реестр подменяют: другой адрес или папка на диске (проверка pull request'а). */
export const REGISTRY_ENV = "MAPWARD_MARKET";

/** Файл индекса в реестре по виду. */
export const INDEX_FILE: Record<MarketKind, string> = { plugin: "plugins.json", map: "maps.json" };

export const KINDS: readonly MarketKind[] = ["plugin", "map"];

/** Имя — оно же папка: `_plugins/<имя>`. Поэтому строчные латинские, цифры и дефис. */
const NAME = /^[a-z0-9][a-z0-9-]*$/;
/** Владелец на GitHub — латиница, цифры и дефис, без точек: так `gitlab.com/x` не сойдёт за него. */
const REPO = /^[A-Za-z0-9-]+\/[\w.-]+$/;
const GITHUB = /^https?:\/\/github\.com\/([A-Za-z0-9-]+\/[\w.-]+?)(?:\.git)?\/?$/;

/** `владелец/репозиторий` из того, как его записали; не GitHub — `undefined`. */
export function repoOf(value: string): string | undefined {
  const trimmed = value.trim();
  if (REPO.test(trimmed)) return trimmed;
  return GITHUB.exec(trimmed)?.[1];
}

/**
 * Индекс по тексту файла. Ошибки — построчно, с номером строки индекса: их читает и бот реестра,
 * и агент, у которого индекс не разобрался.
 */
export function parseIndex(
  text: string,
  kind: MarketKind,
): { entries: MarketEntry[]; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { entries: [], errors: [`${INDEX_FILE[kind]} не json: ${String(error)}`] };
  }
  if (!Array.isArray(raw)) {
    return { entries: [], errors: [`${INDEX_FILE[kind]}: ожидался массив строк индекса`] };
  }
  const entries: MarketEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item: unknown, index) => {
    const at = `${INDEX_FILE[kind]}[${index}]`;
    if (typeof item !== "object" || item === null) {
      errors.push(`${at}: ожидался объект { name, description, repo, branch }`);
      return;
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const repo = typeof row.repo === "string" ? repoOf(row.repo) : undefined;
    const branch = row.branch === undefined ? "main" : row.branch;
    const wrong: string[] = [];
    if (!NAME.test(name)) wrong.push("name — строчные латинские, цифры и дефис");
    if (!description) wrong.push("description — непустая строка: по нему ищут");
    if (!repo) wrong.push("repo — владелец/репозиторий или ссылка на GitHub");
    if (typeof branch !== "string" || !branch.trim()) wrong.push("branch — имя ветки");
    if (seen.has(name)) wrong.push(`name ${name} уже занято выше`);
    if (wrong.length > 0) {
      errors.push(`${at}: ${wrong.join("; ")}`);
      return;
    }
    seen.add(name);
    entries.push({ kind, name, description, repo: repo ?? "", branch: String(branch).trim() });
  });
  return { entries, errors };
}

/**
 * Поиск по имени и описанию: каждое слово запроса ищется подстрокой без регистра, выше те, где
 * совпало больше слов, а совпадение в имени весит больше. Пустой запрос — весь индекс.
 */
export function searchEntries(entries: readonly MarketEntry[], query: string): MarketEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  const scored = entries
    .map((entry) => {
      const name = entry.name.toLowerCase();
      const text = entry.description.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (name.includes(word)) score += 2;
        else if (text.includes(word)) score += 1;
      }
      return { entry, score };
    })
    .filter(({ score }) => score > 0);
  return scored.toSorted((a, b) => b.score - a.score).map(({ entry }) => entry);
}

/** Архив ветки или коммита на GitHub. Ветка — `refs/heads/…`, чтобы не спутать с тегом. */
export function archiveUrl(repo: string, ref: { branch: string } | { commit: string }): string {
  const target = "commit" in ref ? ref.commit : `refs/heads/${ref.branch}`;
  return `https://codeload.github.com/${repo}/tar.gz/${target}`;
}
