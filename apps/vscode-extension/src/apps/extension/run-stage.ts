import { findObject } from "@mapward/core";
import { objectPrompt } from "@mapward/abstract-server";
import type { MapServer } from "@mapward/abstract-server";
import {
  openTerminal,
  pickStageSession,
  rememberDirectiveRun,
  renameForStage,
  sendToTerminal,
} from "@/features/terminals/index.extension.ts";
import { rememberStage } from "./stage-tabs.ts";

/**
 * Кнопка этапа: фраза уходит в живую сессию объекта, промпт агент берёт из MCP сам —
 * решение 0017. Входов два — ряд этапов на карте и кнопки в файле директивы (0032), — а
 * логика одна, поэтому она здесь, где сводятся сервер карты и терминалы.
 *
 * Получатель — терминал, где эту директиву последний раз запускали кнопкой, дальше прежний
 * порядок. Сессии нет — заводим её обычным путём, с промптом объекта, и фраза приезжает
 * следом. Курсор при этом остаётся там, где был.
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

  const existing = pickStageSession(params);
  if (existing) await sendToTerminal({ id: existing.id, text });

  // Новой сессии фраза едет внутри промпта, а не строкой следом: `claude` ещё не поднялся,
  // и отправленное вдогонку попало бы в шелл.
  const session =
    existing ??
    (await openTerminal({
      name: `mapward: ${object.name}`,
      address: params.address,
      cwd: params.basePath,
      prompt: [objectPrompt(object, params.mapPath), "", text].join("\n"),
      fresh: true,
      preserveFocus: true,
    }));

  rememberDirectiveRun({ address: params.address, directive: params.directive, id: session.id });
  rememberStage(session.id, {
    address: params.address,
    directive: params.directive,
    stage: params.stage,
    base: object.name,
  });
  await renameForStage({
    id: session.id,
    base: object.name,
    directive: params.directive,
    stage: params.stage,
  });
  return session;
}
