import { useEffect, useState } from "react";
import type { Capabilities } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";

/**
 * Что умеет хост, поднявший сервер — решение 0014. Из терминала терминалов нет, и клиент
 * узнаёт об этом заранее, а не рисует кнопку, за которой ничего не произойдёт.
 */
export function useCapabilities(): Capabilities {
  const bridge = useBridgeClient();
  const [capabilities, setCapabilities] = useState<Capabilities>({
    terminals: false,
    openFile: false,
    ask: false,
    virtualDocs: false,
    tabs: false,
  });

  useEffect(() => {
    void bridge.getCapabilities().then(setCapabilities);
  }, [bridge]);

  return capabilities;
}
