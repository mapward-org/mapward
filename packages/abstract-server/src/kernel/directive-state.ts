import type { DirectiveStatus, MapFile } from "@mapward/core";
import { frontmatter } from "../lib/frontmatter.ts";

/**
 * Состояние директивы живёт во frontmatter её же файла: статус, последний этап, счётчик кругов и
 * время закрытия. Файла рядом нет — отслеживать изменения текста не нужно, директива и так
 * меняется после каждого этапа.
 *
 * Знание общее для двух фич: карта читает его в модель, директивы пишут на начале и конце этапа.
 * Поэтому оно здесь, а не в одной из них.
 */
export type DirectiveState = {
  status: DirectiveStatus;
  stage?: string;
  runs?: Record<string, number>;
  closedAt?: string;
};

/** Ключи, которые ведёт сервер. Остальные строки frontmatter — автора, их не трогаем. */
const OWN = ["status", "stage", "runs", "closedAt"] as const;

const STATUSES = new Set<string>(["new", "running", "waiting", "done"]);

/** Fence с захватом: тело после него сохраняется побайтно. */
const FENCE = /^---(\r?\n)([\s\S]*?)\r?\n---(\r?\n|$)/;

function parseRuns(value: string | undefined): Record<string, number> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const runs: Record<string, number> = {};
    for (const [stage, count] of Object.entries(parsed)) {
      if (typeof count === "number" && Number.isFinite(count)) runs[stage] = count;
    }
    return runs;
  } catch {
    return undefined;
  }
}

/** Состояние из текста директивы. Нет frontmatter или статуса в нём — директива новая. */
export function readDirectiveState(text: string | undefined): DirectiveState {
  if (text === undefined) return { status: "new" };
  const { fields } = frontmatter(text);
  const status = fields.status !== undefined && STATUSES.has(fields.status) ? fields.status : "new";
  const runs = parseRuns(fields.runs);
  return {
    status: status as DirectiveStatus,
    ...(fields.stage ? { stage: fields.stage } : {}),
    ...(runs === undefined ? {} : { runs }),
    ...(fields.closedAt ? { closedAt: fields.closedAt } : {}),
  };
}

/** Файл директивы вместе с её состоянием — так его видит модель. */
export const withState = (file: MapFile, text: string | undefined): MapFile => ({
  ...file,
  ...readDirectiveState(text),
});

function stateLines(state: DirectiveState): string[] {
  return [
    `status: ${state.status}`,
    ...(state.stage === undefined ? [] : [`stage: ${state.stage}`]),
    ...(state.runs === undefined ? [] : [`runs: ${JSON.stringify(state.runs)}`]),
    ...(state.closedAt === undefined ? [] : [`closedAt: ${state.closedAt}`]),
  ];
}

/**
 * Записать состояние во frontmatter: меняются только свои строки, чужие и тело остаются как
 * были. Нет frontmatter — он встаёт сверху, перевод строки берётся у самого файла.
 */
export function writeDirectiveState(text: string, state: DirectiveState): string {
  const match = FENCE.exec(text);
  if (!match) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    return ["---", ...stateLines(state), "---", ""].join(eol) + text;
  }

  const eol = match[1] ?? "\n";
  const foreign = (match[2] ?? "").split(/\r?\n/).filter((line) => {
    const at = line.indexOf(":");
    const key = at <= 0 ? "" : line.slice(0, at).trim();
    return !(OWN as readonly string[]).includes(key);
  });
  const head = ["---", ...foreign.filter((line) => line.length > 0), ...stateLines(state), "---"];
  const body = text.slice(match[0].length);
  return head.join(eol) + eol + body;
}

/** Этап начался: директива идёт, круг этапа засчитан, отметка о закрытии снята. */
export function stageStarted(state: DirectiveState, stage: string): DirectiveState {
  // Считается начало, а не конец: прогон, брошенный на середине, — тоже круг.
  const runs = { ...state.runs, [stage]: (state.runs?.[stage] ?? 0) + 1 };
  return { status: "running", stage, runs };
}

/** Этап кончился: ход у человека, а этап, которому это поручено, директиву закрывает. */
export function stageFinished(
  state: DirectiveState,
  params: { stage: string; marksDone: boolean; now: Date },
): DirectiveState {
  const runs = state.runs === undefined ? {} : { runs: state.runs };
  return params.marksDone
    ? { status: "done", stage: params.stage, ...runs, closedAt: params.now.toISOString() }
    : { status: "waiting", stage: params.stage, ...runs };
}
