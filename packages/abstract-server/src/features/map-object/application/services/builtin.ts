import type { MetricConfig } from "@mapward/core";
import type { ServerPorts } from "../../../../ports/index.ts";
import { createGitStatus } from "./git-status.ts";
import { fileLinks, markGit } from "../use-cases/git-mark.ts";

/**
 * Встроенные трансформы — решение 0023.
 *
 * Третий вид шага рядом со `script` и `prompt`: тело лежит в инструменте, конфиг называет его
 * именем и ничего не описывает командой. Заводится он ради того, чего `script` не умеет, —
 * своего состояния и своего вотчера: пометка про файл протухает не по часам, а по `.git`.
 */

export type BuiltinStep = {
  /** Посчитать. Ошибка сюда не приходит: шаг сам решает, что делать с неудачей. */
  run(input: unknown): Promise<{ value: unknown; log?: string }>;
  /**
   * Следить за тем, от чего зависит ответ, и звать обратно, когда он протух. Есть вотчер —
   * значит у шага есть состояние, и свежесть по `transformsStaleTime` ему не считается.
   *
   * Кроме данных шагу отдаётся путь объекта: метрика, которая ещё ни разу не собиралась, узлов
   * не дала, а следить за её репозиторием уже надо — иначе первый прогон случится, а второго
   * никто не разбудит.
   */
  watch(input: unknown, objectPath: string, onChange: () => void): () => void;
};

export type Builtins = ReturnType<typeof createBuiltins>;

const kindOf = (spec: Record<string, unknown>): string => String(spec.kind ?? "");

export function createBuiltins(ports: ServerPorts) {
  const git = createGitStatus(ports);

  const steps: Record<string, BuiltinStep> = {
    "git-status": {
      async run(input) {
        const lookup = await git.lookup(fileLinks(input));
        // Упавший git метрику не роняет: данные проходят дальше без пометок, причина — в логе.
        // Не сошлась пометка, а не данные, и красить из-за неё метрику значило бы врать.
        return {
          value: markGit(input, lookup.letterOf),
          ...(lookup.log === undefined ? {} : { log: lookup.log }),
        };
      },
      watch(input, objectPath, onChange) {
        // Корни те же, по которым ставились пометки, плюс репозиторий самого объекта — на
        // случай, когда узлов ещё нет. Статус при этом не гоняется: вотчеру нужен корень.
        let stop: (() => void) | undefined;
        let dropped = false;
        void git.roots([...fileLinks(input), `${objectPath}/_index.json`]).then((roots) => {
          if (dropped) return;
          stop = git.watchRoots(roots, onChange);
        });
        return () => {
          dropped = true;
          stop?.();
        };
      },
    },
  };

  /** Встроенные шаги метрики по порядку — их вотчеры поднимает стор. */
  const stepsOf = (config: MetricConfig): BuiltinStep[] =>
    (config.transforms ?? [])
      .map((spec) => steps[kindOf(spec)])
      .filter((step): step is BuiltinStep => step !== undefined);

  return {
    /** Есть ли такой встроенный шаг: по нему `transform` решает, звать реестр или оболочку. */
    step: (kind: string): BuiltinStep | undefined => steps[kind],

    stepsOf,

    /**
     * Есть ли у метрики шаг со своим состоянием. Такой стадии трансформа свежесть не считается:
     * её ответ протухает от `.git`, а не от часов — решение 0023.
     */
    stateful: (config: MetricConfig): boolean => stepsOf(config).length > 0,
  };
}
