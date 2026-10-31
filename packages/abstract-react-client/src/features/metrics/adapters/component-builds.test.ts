import { defer, Subject } from "rxjs";
import { expect, test } from "vitest";
import type { AppBridge, BridgeClient, ComponentBuild } from "@mapward/core";
import { ComponentBuilds } from "./component-builds.ts";

/**
 * Сборка компонента переживает отписку: клетка ушла с экрана при смене вкладки, вернулась — и
 * рисуется прежним компонентом сразу, а не «собирается», пока сервер отвечает заново.
 */

function bridge() {
  const answers: Subject<ComponentBuild>[] = [];
  const client = {
    // Подписка моста холодная: каждая подписка — новый ответ сервера.
    watchComponent: () =>
      defer(() => {
        const answer = new Subject<ComponentBuild>();
        answers.push(answer);
        return answer;
      }),
  } as unknown as BridgeClient<AppBridge>;
  return { client, answers };
}

const ref = { mapPath: "/map", basePath: "/", name: "Карта" };
const first: ComponentBuild = { code: "a", builtAt: "1" };

test("отписанная сборка остаётся, та же сборка от сервера не будит вид, новая — заменяет", () => {
  const { client, answers } = bridge();
  const builds = new ComponentBuilds(client, ref);
  const build = builds.of("mapward://core/_metrics/m");
  // Одно хранилище — один ресурс на метрику: вернувшаяся клетка берёт тот же.
  expect(builds.of("mapward://core/_metrics/m")).toBe(build);

  const shown = build.changed$.subscribe();
  answers[0]!.next(first);
  expect(build.value).toEqual(first);
  shown.unsubscribe();

  // Вкладка ушла и вернулась: значение на месте сразу, до ответа сервера.
  let woke = 0;
  const again = build.changed$.subscribe(() => {
    woke += 1;
  });
  expect(build.value).toEqual(first);
  expect(build.ready).toBe(false);

  answers[1]!.next({ code: "a", builtAt: "1" });
  expect([woke, build.ready]).toEqual([0, true]);

  answers[1]!.next({ code: "b", builtAt: "2" });
  expect([woke, build.value?.code]).toEqual([1, "b"]);
  again.unsubscribe();
});
