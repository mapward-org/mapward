import { MAP_ROOT } from "@mapward/core";
import { directivePrompt, objectPrompt } from "@mapward/abstract-server";
import type { MapServer } from "@mapward/abstract-server";
import {
  directiveTabName,
  directiveTerminal,
  onceForDirective,
  openTerminal,
  pickStageSession,
  renameForStage,
  sendToTerminal,
  stageName,
} from "@/features/terminals/index.extension.ts";
import { terminalLocation } from "@/features/directive-layout/index.extension.ts";

type MapParams = { mapPath: string; basePath: string; name: string; address: string };

async function readHolder(server: MapServer, params: MapParams) {
  const object =
    (await server.readObject({ ...params, depth: 0 })) ??
    (await server.readObject({ ...params, address: MAP_ROOT, depth: 0 }));
  if (!object) throw new Error(`Объект ${params.address} не найден`);
  return object;
}

/**
 * Кнопка этапа: фраза уходит в живую сессию объекта, промпт агент берёт из MCP сам —
 * решение 0017. Входов два — ряд этапов на карте и кнопки в файле директивы (0032), — а
 * логика одна, поэтому она здесь, где сводятся сервер карты и терминалы.
 *
 * Получатель — терминал этой директивы и только он: в чужой разговор фраза не уходит. Его нет —
 * заводим новый, и он с этого момента принадлежит директиве; был у директивы разговор раньше —
 * новый терминал его продолжает. Курсор при этом остаётся там, где был.
 */
export async function runStage(
  server: MapServer,
  params: MapParams & { directive: string; stage: string },
): Promise<{ id: string; name: string }> {
  const { text } = await server.stageRequest(params);
  const object = await readHolder(server, params);

  const tab = { base: object.name, directive: params.directive, stage: params.stage };
  const directivePath = object.directives.find((file) => file.name === params.directive)?.path;

  // Новой сессии фраза едет внутри промпта, а не строкой следом: `claude` ещё не поднялся,
  // и отправленное вдогонку попало бы в шелл.
  // Имя этапа новый терминал получает при рождении: переименование работает над активным
  // терминалом, а только что заведённый им ещё не стал, и вкладка до конца этапа оставалась
  // с именем объекта.
  // Терминал директивы живёт вкладкой под её файлом — место называет раскладка.
  const open = async () =>
    openTerminal({
      ...(directivePath === undefined
        ? {}
        : { directivePath, location: await terminalLocation(directivePath) }),
      name: stageName(tab),
      address: params.address,
      cwd: params.basePath,
      // Агент сразу знает, чья он директива; разогрев ему не нужен — фраза этапа едет следом.
      prompt: [
        directivePath === undefined
          ? objectPrompt(object, params.mapPath)
          : directivePrompt({
              object,
              mapPath: params.mapPath,
              directive: params.directive,
              directivePath,
              warmUp: false,
            }),
        "",
        text,
      ].join("\n"),
      // Продолженный разговор свой промпт уже слышал — ему только фраза этапа.
      resumePrompt: text,
      fresh: true,
      directive: params.directive,
      preserveFocus: true,
    });

  const existing = pickStageSession(params);
  if (existing) {
    await sendToTerminal({ id: existing.id, text });
    await renameForStage({ id: existing.id, ...tab });
    return existing;
  }

  // Раскладка заводит терминал, когда директиву открыли, а кнопка открывает директиву сама:
  // заводит тот, кто успел первым. Успела раскладка — фраза уходит в её терминал.
  const created =
    directivePath === undefined ? await open() : await onceForDirective(directivePath, open);
  if (created) return created;
  const late = pickStageSession(params);
  if (!late) throw new Error(`Терминал директивы ${params.directive} не завёлся`);
  await sendToTerminal({ id: late.id, text });
  await renameForStage({ id: late.id, ...tab });
  return late;
}

/**
 * Директиву открыли, а терминала у неё нет — завести: рядом с директивой всегда её агент. Был
 * разговор — он продолжается молча; не было — начинается с промпта директивы и разогревается:
 * пока автор пишет, агент собирает контекст, и первый этап начинается сразу.
 */
export async function openDirectiveTerminal(
  server: MapServer,
  params: MapParams & { directive: string; directivePath: string },
): Promise<void> {
  await onceForDirective(params.directivePath, async () => {
    if (directiveTerminal(params.directivePath)) return;
    const object = await readHolder(server, params);
    await openTerminal({
      directivePath: params.directivePath,
      location: await terminalLocation(params.directivePath),
      name: directiveTabName({ base: object.name, directive: params.directive }),
      address: params.address,
      cwd: params.basePath,
      prompt: directivePrompt({
        object,
        mapPath: params.mapPath,
        directive: params.directive,
        directivePath: params.directivePath,
        warmUp: true,
      }),
      fresh: true,
      directive: params.directive,
      preserveFocus: true,
    });
  });
}
