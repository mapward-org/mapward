import type { AppBridge, BridgeClient, PluginEvent } from "@mapward/core";
import type { Navigate, OpenHow } from "@mapward/component";

type Ref = { mapPath: string; basePath: string; name: string };

/** Что навигации нужно от экрана: переход к объекту, а с табами — ещё и табом. */
export type NavigationScreen = {
  goTo(address: string): void;
  openObjectTab?: ((address: string) => void) | undefined;
};

/** Ответ плагина `navigation` на `open`: объект — переход за экраном, остальное он открыл сам. */
type Opened = { kind: "object"; address: string } | { kind: "file" | "url" };

/**
 * `useNavigation` набора: ссылку разбирает встроенный плагин `navigation` карты — его правят под
 * проект, поэтому клиент своего разбора ссылок для компонентов не держит. Объект карты плагин не
 * открывает (об экране он не знает) и отвечает адресом — переход здесь.
 *
 * Плагин лежит в `_plugins/navigation` карты; копии нет — платформа доставит её сама. Не открылось
 * (нет редактора, плагин упал) — клик молча ничего не делает, как ссылка на файл в хосте без
 * редактора (решение 0014).
 */
export class Navigation {
  readonly tabs: boolean;

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly ref: Ref,
    private readonly screen: NavigationScreen,
  ) {
    this.tabs = screen.openObjectTab !== undefined;
  }

  private get plugin(): string {
    return `${this.ref.mapPath.replaceAll("\\", "/").replace(/\/+$/, "")}/_plugins/navigation`;
  }

  /** Стрелкой: уходит в `onClick` кирпичей как есть. */
  readonly open: Navigate = (target, how) => {
    const link = typeof target === "string" ? target : target.link;
    if (!link) return;
    this.bridge
      .callPlugin({ ...this.ref, plugin: this.plugin, method: "open", args: { link } })
      .subscribe({
        next: (event: PluginEvent) => {
          if (event.kind === "next") this.arrive(event.value as Opened, how);
        },
        error: () => {},
      });
  };

  private arrive(opened: Opened | undefined, how: OpenHow | undefined): void {
    if (opened?.kind !== "object") return;
    if (how?.tab && this.screen.openObjectTab) this.screen.openObjectTab(opened.address);
    else this.screen.goTo(opened.address);
  }
}
