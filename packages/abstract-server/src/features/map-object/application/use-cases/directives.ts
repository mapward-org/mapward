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

/**
 * Состояние прогона пишет сервер, а не агент — решение 0017. Агент сообщает событие: этап
 * начался, этап кончился. Формат состояния и копия текста — внутреннее дело карты.
 *
 * Копия снимается только этапом, которому поручено помечать выполнение: по ней потом видно,
 * менялась ли директива после того, как её сделали. Этап без такого поручения оставляет след
 * о прогоне, но директива остаётся незакрытой.
 */
export type DirectiveState = {
  directive?: string;
  status?: "done";
  ran?: string;
  run?: { stage: string; startedAt: string; finishedAt?: string };
  /**
   * Сколько раз какой этап начинали. Полной истории прогонов здесь нет намеренно: она растёт
   * без предела, а спрашивают у неё одно — сколько кругов уже прошло. Счётчик отвечает на это
   * и не меняет формат состояния, а дополняет его.
   */
  runs?: Record<string, number>;
};

const statePath = (objectPath: string, directive: string) =>
  join(objectPath, "_directives.state", `${directive.replace(/\.md$/, "")}.state.json`);

/**
 * Директива зовётся именем файла, а не путём: сложенный из чужих кусков путь увёл бы удаление
 * за пределы папки объекта.
 */
const isDirectiveName = (name: string) =>
  name.endsWith(".md") && !name.includes("..") && !/[\\/]/.test(name);

/**
 * Удалить директиву целиком: вместе с файлом уходит состояние её прогонов — где оно лежит,
 * знает карта, и чистит его сервер, а не хост.
 *
 * Удаляется только своя: доставшаяся от прототипа лежит в чужой папке, и в `_directives`
 * этого объекта её нет — тогда удалять нечего, и это не ошибка, а ответ `deleted: false`.
 */
export async function deleteDirective(
  ports: ServerPorts,
  params: { objectPath: string; directive: string },
): Promise<{ deleted: boolean }> {
  if (!isDirectiveName(params.directive)) {
    throw new Error(`Не имя директивы: ${params.directive}`);
  }

  const path = join(params.objectPath, "_directives", params.directive);
  if ((await ports.files.read(path)) === undefined) return { deleted: false };

  await ports.files.remove(path);
  await ports.files.remove(statePath(params.objectPath, params.directive));
  return { deleted: true };
}

async function readState(
  ports: ServerPorts,
  objectPath: string,
  directive: string,
): Promise<DirectiveState> {
  const raw = await ports.files.read(statePath(objectPath, directive));
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw) as DirectiveState;
  } catch {
    return {};
  }
}

const writeState = (
  ports: ServerPorts,
  objectPath: string,
  directive: string,
  state: DirectiveState,
) => ports.files.write(statePath(objectPath, directive), `${JSON.stringify(state, null, 2)}\n`);

export async function startStage(
  ports: ServerPorts,
  params: { objectPath: string; directive: string; stage: string; now: Date },
): Promise<void> {
  const state = await readState(ports, params.objectPath, params.directive);
  // Считается начало, а не конец: прогон, брошенный на середине, — тоже круг, и по счётчику
  // это должно быть видно.
  const runs = { ...state.runs, [params.stage]: (state.runs?.[params.stage] ?? 0) + 1 };
  await writeState(ports, params.objectPath, params.directive, {
    ...state,
    runs,
    run: { stage: params.stage, startedAt: params.now.toISOString() },
  });
}

export async function finishStage(
  ports: ServerPorts,
  params: {
    objectPath: string;
    directivePath: string;
    directive: string;
    stage: string;
    marksDone: boolean;
    now: Date;
  },
): Promise<void> {
  const state = await readState(ports, params.objectPath, params.directive);
  const run = {
    stage: params.stage,
    startedAt: state.run?.stage === params.stage ? state.run.startedAt : params.now.toISOString(),
    finishedAt: params.now.toISOString(),
  };

  if (!params.marksDone) {
    await writeState(ports, params.objectPath, params.directive, { ...state, run });
    return;
  }

  // Копия нужна побайтно: пересказ ломает сравнение, по которому выполненная директива
  // отличается от изменившейся.
  const text = await ports.files.read(params.directivePath);
  await writeState(ports, params.objectPath, params.directive, {
    ...state,
    directive: text ?? "",
    status: "done",
    ran: params.now.toISOString(),
    run,
  });
}
