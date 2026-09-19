import type { BridgeClient } from "@mapward/core";
import type { AppBridge } from "@mapward/core";
import { ProviderBridgeClient } from "../ports/bridge.tsx";
import { ProviderIcons, type RenderIcon } from "../ports/icons.tsx";
import { Maps } from "../features/maps/index.ts";
import { MapObjectView } from "../features/map-object/index.ts";

/**
 * Сборка клиента: карты аккордеоном, внутри объект. Мост приходит снаружи — приложение решает,
 * каким транспортом он ходит (решение 0014), а клиент знает только контракт из `core`.
 */
export function MapwardApp(props: { client: BridgeClient<AppBridge>; icon?: RenderIcon }) {
  return (
    <ProviderBridgeClient client={props.client}>
      <ProviderIcons render={props.icon}>
        <Maps renderMap={(map) => <MapObjectView mapConfig={map} />} />
      </ProviderIcons>
    </ProviderBridgeClient>
  );
}
