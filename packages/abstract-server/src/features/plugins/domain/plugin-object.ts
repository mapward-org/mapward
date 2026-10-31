import type { MapObject } from "@mapward/core";
import type { PluginObject } from "@mapward/plugin";

/**
 * Объект карты так, как его видит плагин: мердж и подстановки уже сделаны платформой, а
 * метрик, директив и экшонов ему не нужно — это интерфейс карты, а не данные. Дети — адресами:
 * поддерево целиком плагин спросит сам, если оно ему нужно.
 */
export function toPluginObject(object: MapObject): PluginObject {
  return {
    address: object.address,
    name: object.name,
    path: object.path,
    ...(object.prototypeName === undefined ? {} : { prototype: object.prototypeName }),
    props: object.props,
    children: object.children.map((child) => child.address),
  };
}

/** Ключ процесса: один процесс на плагин на карту. */
export const instanceKey = (mapPath: string, plugin: string) => `${mapPath}|${plugin}`;

/** Имя файла сборки: путь плагина без разделителей, чтобы два плагина не делили файл. */
export function scriptName(mapPath: string, plugin: string): string {
  const relative = plugin.startsWith(`${mapPath}/`) ? plugin.slice(mapPath.length + 1) : plugin;
  return `${relative
    .replace(/^[a-zA-Z]:/, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+/, "")}.cjs`;
}
