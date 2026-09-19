import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { appBridge, createBridgeClient } from "@mapward/core";
import { MapwardApp } from "@mapward/abstract-react-client";
import { extensionTransport } from "@/shared/bridge/transport.ts";

/** Порты клиента со стороны редактора: мост поверх `postMessage`, тема — переменными vscode. */
const client = createBridgeClient(appBridge, extensionTransport());

/** Иконки редактора: клиент просит по имени, codicon знает только хост. */
const icon = (name: string, className?: string) => (
  <span className={`codicon codicon-${name} ${className ?? ""}`} />
);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <MapwardApp client={client} icon={icon} />
    </StrictMode>,
  );
}
