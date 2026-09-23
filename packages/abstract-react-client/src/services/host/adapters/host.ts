import { once } from "@mapward/core";
import type { AppBridge, BridgeClient, Capabilities } from "@mapward/core";

const NOTHING: Capabilities = {
  terminals: false,
  openFile: false,
  ask: false,
  virtualDocs: false,
  tabs: false,
};

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Хост, поднявший клиент, — решение 0014: что он умеет и что умеет открыть. Клиент рисует
 * только то, что хост обещал: из терминала терминалов нет, и кнопки за ними тоже.
 */
export class Host {
  private readonly capabilities = once(() => this.bridge.getCapabilities());

  constructor(private readonly bridge: BridgeClient<AppBridge>) {}

  /** Пока хост не ответил, он не умеет ничего: кнопка, которая появится позже, лучше мёртвой. */
  get can(): Capabilities {
    return this.capabilities.value ?? NOTHING;
  }

  open(path: string): void {
    void this.bridge.openPath({ path });
  }

  openExternal(url: string): void {
    void this.bridge.openExternal({ url });
  }

  /** Текст, которого нет на диске: мердженный конфиг метрики — решение 0019. */
  openVirtual(title: string, text: string, language: string): void {
    void this.bridge.openVirtual({ title, text, language });
  }

  /**
   * Открыть объект отдельным табом редактора — решение 0026. Таб всегда показывает объект;
   * `group` говорит, какая вкладка в нём открыта, `metric` — что показана одна метрика.
   */
  openInTab(target: Ref & { address: string; group?: string; metric?: string }): void {
    void this.bridge.openInTab(target);
  }
}
