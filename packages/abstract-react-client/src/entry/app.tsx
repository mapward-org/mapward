import type { BridgeClient } from "@mapward/core";
import type { AppBridge } from "@mapward/core";
import { ProviderBridgeClient } from "../ports/bridge.tsx";
import { ProviderIcons, type RenderIcon } from "../ports/icons.tsx";
import { Maps } from "../features/maps/index.ts";
import { MapObjectView } from "../features/map-object/index.ts";

/**
 * На чём открыт таб — решение 0026: карта названа целиком, потому что таб живёт сам по себе и
 * выбором карты в сайдбаре не управляется.
 */
export type TabTarget = {
  mapPath: string;
  basePath: string;
  name: string;
  address: string;
  group?: string;
  metric?: string;
};

/**
 * Сборка клиента: карты аккордеоном, внутри объект. Мост приходит снаружи — приложение решает,
 * каким транспортом он ходит (решение 0014), а клиент знает только контракт из `core`.
 *
 * С `target` это тот же клиент, открытый на одном объекте: списка карт в табе нет — карту в нём
 * уже выбрали, и выбор её заново означал бы второй сайдбар внутри таба (решение 0026).
 */
export function MapwardApp(props: {
  client: BridgeClient<AppBridge>;
  icon?: RenderIcon;
  target?: TabTarget;
}) {
  const { target } = props;

  return (
    <ProviderBridgeClient client={props.client}>
      <ProviderIcons render={props.icon}>
        {target ? (
          <MapObjectView
            mapConfig={{
              mapPath: target.mapPath,
              basePath: target.basePath,
              name: target.name,
            }}
            start={{
              address: target.address,
              ...(target.group === undefined ? {} : { group: target.group }),
              ...(target.metric === undefined ? {} : { metric: target.metric }),
            }}
          />
        ) : (
          <Maps renderMap={(map) => <MapObjectView mapConfig={map} />} />
        )}
      </ProviderIcons>
    </ProviderBridgeClient>
  );
}
