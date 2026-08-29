import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Maps } from "@/features/maps/index.webview.ts";
import { MapObjectView } from "@/features/map-object/index.webview.ts";
import { BridgeProvider } from "./client-provider.tsx";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BridgeProvider>
        <Maps renderMap={(map) => <MapObjectView mapConfig={map} />} />
      </BridgeProvider>
    </StrictMode>,
  );
}
