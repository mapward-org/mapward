import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { appBridge, createBridgeClient } from "@mapward/core";
import { MapwardApp, type TabTarget } from "@mapward/abstract-react-client";
import { extensionTransport, vsCodeApi } from "@/shared/bridge/transport.ts";

/** Порты клиента со стороны редактора: мост поверх `postMessage`, тема — переменными vscode. */
const client = createBridgeClient(appBridge, extensionTransport());

/** Иконки редактора: клиент просит по имени, codicon знает только хост. */
const icon = (name: string, className?: string) => (
  <span className={`codicon codicon-${name} ${className ?? ""}`} />
);

/**
 * На чём открыт этот вебвью — решение 0026. В сайдбаре ни на чём, и тогда показываются карты
 * списком. В табе адрес приезжает страницей, а после перезапуска окна — из состояния вебвью:
 * страницу в этом случае собирает редактор, и вписать в неё адрес некому.
 */
const api = vsCodeApi();
// oxlint-disable-next-line no-underscore-dangle -- имя переменной страницы, а не наше поле
const fromPage = (globalThis as { __mapwardTarget?: TabTarget }).__mapwardTarget;
const target = fromPage ?? (api.getState() as TabTarget | undefined);
// Сохраняется сразу: перезапуск окна случается когда угодно, а спросить об этом вебвью нельзя.
if (target) api.setState(target);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <MapwardApp client={client} icon={icon} {...(target ? { target } : {})} />
    </StrictMode>,
  );
}
