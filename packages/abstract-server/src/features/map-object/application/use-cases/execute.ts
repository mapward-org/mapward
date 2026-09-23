import type { ActionPermissions, MapObject } from "@mapward/core";
import type { Cancellation, ProcessEnv, ServerPorts } from "../../../../ports/index.ts";

/**
 * Запуск команды и агента — одним кодом для коллектора и для экшона (решение 0038): метрика
 * и экшон отличаются тем, что делают с ответом, а не тем, как его получают.
 */

/** Команда оболочки из корня карты. Вход, если есть, уходит в stdin — экранировать нечего. */
export function runScript(
  ports: ServerPorts,
  params: { command: string; cwd: string; env: ProcessEnv; input?: string; cancel?: Cancellation },
) {
  return params.input === undefined
    ? ports.shell.run(params.command, { cwd: params.cwd, env: params.env, cancel: params.cancel })
    : ports.shell.pipe(params.command, {
        cwd: params.cwd,
        env: params.env,
        input: params.input,
        cancel: params.cancel,
      });
}

/**
 * Агент в headless-режиме. Объект уходит в начало промпта — решение 0004: подстановка
 * достаёт до текста, написанного человеком, но не до адреса объекта, на котором висит шаг.
 */
export function runPrompt(
  ports: ServerPorts,
  params: {
    owner: MapObject;
    text: string;
    /** Что дописать в конец: форму ответа у метрики, данные формы у экшона. */
    tail?: string;
    cwd: string;
    env: ProcessEnv;
    cancel?: Cancellation;
    permissions?: ActionPermissions;
  },
) {
  const owner = params.owner;
  const about = `Объект карты: «${owner.name}», адрес ${owner.address}, путь ${owner.path}.`;
  const prompt = [about, params.text, params.tail].filter(Boolean).join("\n\n");
  return ports.agent.run({
    prompt,
    cwd: params.cwd,
    env: params.env,
    cancel: params.cancel,
    ...(params.permissions === undefined ? {} : { permissions: params.permissions }),
  });
}
