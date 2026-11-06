import { map, takeWhile } from "rxjs";
import type { AppBridge, BridgeClient, PluginEvent } from "@mapward/core";
import type { PluginStream } from "../pure-model/plugin-stream.ts";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Чей вызов: объект, на котором стоит компонент, и метрика, которой он принадлежит. По ним сервер
 * заводит трейс метрики — её прогон виден на экране прогонов объекта, и красная точка его находит.
 */
export type CallOwner = { object: string; metric: string };

const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);

/** Путь от папки: `..` и `.` разбираются здесь же — платформа ждёт абсолютный путь плагина. */
function join(dir: string, rest: string): string {
  const parts: string[] = [];
  for (const part of `${dir}/${rest}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && (part !== "" || parts.length === 0)) parts.push(part);
  }
  return parts.join("/");
}

/**
 * Вызовы плагинов из компонента метрики: мост до платформы, а она — до процесса плагина. Мост
 * конца у потока не знает, поэтому конец приходит событием и здесь превращается обратно в
 * `complete`. Поток холодный: вызов уходит при подписке, отписка — отмена.
 */
export class PluginCalls {
  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly ref: Ref,
    /** Абсолютный путь файла компонента: от него считаются пути плагинов. */
    private readonly component: string,
    private readonly owner?: CallOwner,
  ) {}

  resolve(path: string): string {
    const given = path.replaceAll("\\", "/");
    if (isAbsolute(given)) return given;
    const dir = this.component.replaceAll("\\", "/").replace(/\/[^/]*$/, "");
    return join(dir, given);
  }

  call(plugin: string, method: string, args: unknown): PluginStream {
    return this.bridge.callPlugin({ ...this.ref, ...this.owner, plugin, method, args }).pipe(
      takeWhile((event: PluginEvent) => event.kind === "next"),
      map((event) => (event as { value: unknown }).value),
    );
  }
}
