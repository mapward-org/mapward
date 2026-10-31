import { of, throwError } from "rxjs";
import { expect, test } from "vitest";
import type { AppBridge, BridgeClient } from "@mapward/core";
import { Navigation } from "./navigation.ts";

const ref = { mapPath: "D:\\proj\\map\\", basePath: "/", name: "Карта" };

/** Мост, который на `callPlugin` отвечает `answer` и запоминает, что спросили. */
function bridgeAnswering(answer: () => ReturnType<BridgeClient<AppBridge>["callPlugin"]>) {
  const asked: unknown[] = [];
  const bridge = {
    callPlugin: (args: unknown) => {
      asked.push(args);
      return answer();
    },
  } as unknown as BridgeClient<AppBridge>;
  return { bridge, asked };
}

test("ссылку разбирает плагин navigation карты, объект — переход экрана, ctrl — табом", () => {
  const { bridge, asked } = bridgeAnswering(() =>
    of({ kind: "next" as const, value: { kind: "object", address: "mapward://core" } }),
  );
  const went: string[] = [];
  const navigation = new Navigation(bridge, ref, {
    goTo: (address) => went.push(`экран ${address}`),
    openObjectTab: (address) => went.push(`таб ${address}`),
  });

  navigation.open("mapward://core");
  navigation.open({ link: "mapward://core" }, { tab: true });
  navigation.open({ label: "без ссылки" } as { link?: string });

  expect(navigation.tabs).toBe(true);
  expect(went).toEqual(["экран mapward://core", "таб mapward://core"]);
  expect(asked).toHaveLength(2);
  expect(asked[0]).toMatchObject({
    plugin: "D:/proj/map/_plugins/navigation",
    method: "open",
    args: { link: "mapward://core" },
  });
});

test("файл плагин открыл сам, ошибка — клик молча ничего не делает; без табов — экраном", () => {
  const went: string[] = [];
  const screen = { goTo: (address: string) => went.push(address) };

  new Navigation(
    bridgeAnswering(() => of({ kind: "next" as const, value: { kind: "file", path: "/a.ts" } }))
      .bridge,
    ref,
    screen,
  ).open("a.ts");
  new Navigation(
    bridgeAnswering(() => throwError(() => new Error("редактора нет"))).bridge,
    ref,
    screen,
  ).open("a.ts");
  const noTabs = new Navigation(
    bridgeAnswering(() =>
      of({ kind: "next" as const, value: { kind: "object", address: "mapward://x" } }),
    ).bridge,
    ref,
    screen,
  );
  noTabs.open("mapward://x", { tab: true });

  expect(noTabs.tabs).toBe(false);
  expect(went).toEqual(["mapward://x"]);
});
