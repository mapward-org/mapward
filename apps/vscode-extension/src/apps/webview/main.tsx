import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Maps } from "../../features/maps/index.webview.ts";
import { BridgeProvider } from "./client-provider.tsx";

/** A map is still a stub — the next feature fills it. Here it only proves what was found. */
function MapStub(props: { name: string; mapPath: string }) {
  return (
    <div className="px-1 py-2 text-sm">
      <div className="font-medium">{props.name}</div>
      <div className="opacity-60">{props.mapPath}</div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BridgeProvider>
        <Maps renderMap={(map) => <MapStub name={map.name} mapPath={map.mapPath} />} />
      </BridgeProvider>
    </StrictMode>,
  );
}
