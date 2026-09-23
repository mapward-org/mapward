import { findObject } from "@mapward/core";
import { objectPrompt } from "@mapward/abstract-server";
import type { MapServer } from "@mapward/abstract-server";
import {
  openTerminal,
  pickStageSession,
  renameForStage,
  sendToTerminal,
  stageName,
} from "@/features/terminals/index.extension.ts";
import { rememberStage } from "./stage-tabs.ts";

/**
 * Кнопка этапа: фраза уходит в живую сессию объекта, промпт агент берёт из MCP сам —
 * решение 0017. Входов два — ряд этапов на карте и кнопки в файле директивы (0032), — а
 * логика одна, поэтому она здесь, где сводятся сервер карты и терминалы.
 *
 * Получатель — терминал этой директивы и только он: в чужой разговор фраза не уходит. Его нет —
 * заводим новый, с промптом объекта, и он с этого момента принадлежит директиве. Курсор при
 * этом остаётся там, где был.
 */
export async function runStage(
  server: MapServer,
  params: {
    mapPath: string;
    basePath: string;
    name: string;
    address: string;
    directive: string;
    stage: string;
  },
): Promise<{ id: string; name: string }> {
  const { text } = await server.stageRequest(params);
  const map = await server.getMap(params);
  const object = findObject(map, params.address) ?? map;

  const tab = { base: object.name, directive: params.directive, stage: params.stage };
  const existing = pickStageSession(params);
  if (existing) await sendToTerminal({ id: existing.id, text });

  // Новой сессии фраза едет внутри промпта, а не строкой следом: `claude` ещё не поднялся,
  // и отправленное вдогонку попало бы в шелл.
  // Имя этапа новый терминал получает при рождении: переименование работает над активным
  // терминалом, а только что заведённый им ещё не стал, и вкладка до конца этапа оставалась
  // с именем объекта.
  const session =
    existing ??
    (await openTerminal({
      name: stageName(tab),
      address: params.address,
      cwd: params.basePath,
      prompt: [objectPrompt(object, params.mapPath), "", text].join("\n"),
      fresh: true,
      directive: params.directive,
      preserveFocus: true,
    }));

  rememberStage(session.id, { address: params.address, ...tab });
  if (existing) await renameForStage({ id: session.id, ...tab });
  return session;
}
