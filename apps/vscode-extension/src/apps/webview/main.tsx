import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { bridgeToExtension } from "../../shared/bridge/webview.ts";

/**
 * The base version only proves the chain: the webview asks the host and shows the answer.
 * Everything the map is made of arrives in step 2 of PLAN.md.
 */
function App() {
  const [answer, setAnswer] = useState<string>();

  useEffect(() => {
    const stop = bridgeToExtension.onMessage((message) => {
      if (message.kind === "pong") setAnswer(message.at);
    });
    bridgeToExtension.post({ kind: "ping" });
    return stop;
  }, []);

  return (
    <main className="p-3 text-sm">
      <h1 className="font-medium">Mapward</h1>
      <p className="opacity-70">{answer ? `на связи, ${answer}` : "соединяемся…"}</p>
    </main>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
