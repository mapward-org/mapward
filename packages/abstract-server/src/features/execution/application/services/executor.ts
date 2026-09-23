import type { ActionPermissions, MapObject } from "@mapward/core";
import type { AgentPort, Cancellation, ProcessEnv, ShellPort } from "../../../../ports/index.ts";

export type ScriptRun = {
  command: string;
  cwd: string;
  env: ProcessEnv;
  /** Вход, если есть, уходит в stdin — экранировать нечего. */
  input?: string;
  cancel?: Cancellation;
};

export type PromptRun = {
  /**
   * Объект уходит в начало промпта — решение 0004: подстановка достаёт до текста, написанного
   * человеком, но не до адреса объекта, на котором висит шаг. Без объекта промпт уходит как есть:
   * так зовёт агента трансформ, которому говорить о себе нечего.
   */
  owner?: MapObject;
  text: string;
  /** Что дописать в конец: форму ответа у метрики, данные формы у экшона. */
  tail?: string;
  cwd: string;
  env: ProcessEnv;
  cancel?: Cancellation;
  permissions?: ActionPermissions;
};

/**
 * Запуск команды и агента — одним кодом для коллектора, трансформа и экшона (решение 0038):
 * метрика и экшон отличаются тем, что делают с ответом, а не тем, как его получают.
 */
export class Executor {
  constructor(
    private readonly shell: ShellPort,
    private readonly agent: AgentPort,
  ) {}

  /** Команда оболочки. */
  script(params: ScriptRun) {
    const { command, cwd, env, cancel } = params;
    return params.input === undefined
      ? this.shell.run(command, { cwd, env, cancel })
      : this.shell.pipe(command, { cwd, env, input: params.input, cancel });
  }

  /** Агент в headless-режиме. */
  prompt(params: PromptRun) {
    const owner = params.owner;
    const about =
      owner && `Объект карты: «${owner.name}», адрес ${owner.address}, путь ${owner.path}.`;
    const prompt = [about, params.text, params.tail].filter(Boolean).join("\n\n");
    return this.agent.run({
      prompt,
      cwd: params.cwd,
      env: params.env,
      cancel: params.cancel,
      ...(params.permissions === undefined ? {} : { permissions: params.permissions }),
    });
  }
}
