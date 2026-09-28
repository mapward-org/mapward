import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeMethod, createBridgeSubscription } from "./bridge.ts";

/**
 * Куда ведёт подключение: папка карты проекта — по ней она ищется среди поднятых — или что не
 * так с настройкой. Ошибка остаётся у своего имени, остальные подключения работают.
 */
export const MountTarget = T.Union([
  T.Object({ mapPath: T.String(), configPath: T.String(), index: T.Number() }),
  T.Object({ error: T.String() }),
]);

/** One map, already resolved to absolute paths — the webview never touches the file system. */
export const ResolvedMap = T.Object({
  name: T.String(),
  mapPath: T.String(),
  basePath: T.String(),
  configPath: T.String(),
  /** Подключённые карты по именам — `mapward://leafer:/…` ищется здесь, у карты со ссылкой. */
  mounts: T.Optional(T.Record(T.String(), MountTarget)),
});

/**
 * Not an error but a state: the sidebar draws a different screen for each. Two kinds of
 * emptiness are told apart on purpose — with no folder open there is nowhere to write a
 * config, so only `no-config` can offer to create one.
 */
export const MapsState = T.Union([
  T.Object({
    kind: T.Literal("maps"),
    maps: T.Array(ResolvedMap),
    /**
     * Карты, до которых дотягиваются только подключениями. Секций в панели у них нет, но
     * объект такой карты открывается переходом по ссылке, и описание её нужно клиенту.
     */
    mounted: T.Optional(T.Array(ResolvedMap)),
  }),
  T.Object({ kind: T.Literal("no-config") }),
  T.Object({ kind: T.Literal("no-workspace") }),
  T.Object({ kind: T.Literal("error"), message: T.String(), configPath: T.Optional(T.String()) }),
]);

export const configBridge = {
  getMaps: createBridgeMethod(T.Void(), MapsState),
  watchMaps: createBridgeSubscription(T.Void(), MapsState),
  createConfig: createBridgeMethod(T.Void(), MapsState),
  openPath: createBridgeMethod(T.Object({ path: T.String() }), T.Void()),
  /** Всё, что не `mapward://` и не файл, уходит наружу — этим занимается хост. */
  openExternal: createBridgeMethod(T.Object({ url: T.String() }), T.Void()),
  /**
   * Показать текст, которого нет на диске: мердженный конфиг метрики собран из нескольких
   * файлов и не лежит ни в одном — решение 0019. Своя ручка, а не путь с оговоркой: у такого
   * документа пути нет вовсе, и метод с необязательным путём был бы двумя методами в одном.
   */
  openVirtual: createBridgeMethod(
    T.Object({ title: T.String(), text: T.String(), language: T.String() }),
    T.Void(),
  ),
  pickFolder: createBridgeMethod(T.Void(), T.Void()),
};

export type ResolvedMap = Static<typeof ResolvedMap>;
export type MountTarget = Static<typeof MountTarget>;
export type MapsState = Static<typeof MapsState>;

/**
 * Карта, подключённая к карте `from` под именем `name`: описание или что не так. Ищется по
 * папке среди всех поднятых — видимых и доступных только подключением.
 */
export function mountedMap(
  maps: ResolvedMap[],
  from: string,
  name: string,
): ResolvedMap | { error: string } {
  const owner = maps.find((map) => samePath(map.mapPath, from));
  const target = owner?.mounts?.[name];
  if (!target) return { error: `У карты нет подключения «${name}»` };
  if ("error" in target) return target;
  const found = maps.find((map) => samePath(map.mapPath, target.mapPath));
  return found ?? { error: `Карта подключения «${name}» не поднята: ${target.mapPath}` };
}

const samePath = (a: string, b: string) =>
  a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase();
