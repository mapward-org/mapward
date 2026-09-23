import type { BridgeClient } from "@mapward/core";
import type { AppBridge } from "@mapward/core";
import { ProviderBridgeClient } from "../ports/bridge.tsx";
import { ProviderIcons, type RenderIcon } from "../ports/icons.tsx";
import { Maps } from "../features/maps/index.ts";
import { MapObjectView, isHistory, type History } from "../features/map-object/index.ts";
import { DirectiveTurns } from "../features/directive-turns/index.ts";
import { useViewState } from "../services/state/index.ts";
import { Loading } from "../lib/ui/loading.tsx";

/**
 * На чём открыт таб — решение 0026: карта названа целиком, потому что таб живёт сам по себе и
 * выбором карты в сайдбаре не управляется. `history` — куда в нём ушли потом (0036): её пишет
 * сам таб, а таб, сохранённый до неё, начинает историю с того, на чём открыт.
 */
export type TabTarget = {
  mapPath: string;
  basePath: string;
  name: string;
  address: string;
  group?: string;
  metric?: string;
  history?: History;
};

type MapRef = { mapPath: string; basePath: string; name: string };

/**
 * История карты в сайдбаре — в состоянии вида, по карте своя (решение 0036). Пока хранилище не
 * ответило, объекта нет: переход, сделанный раньше ответа, затёрла бы пришедшая следом история.
 */
function SidebarObject(props: { map: MapRef }) {
  const [stored, save, loaded] = useViewState<unknown>(`history:${props.map.mapPath}`, undefined);
  if (!loaded) return <Loading text="Читаем карту…" />;
  return (
    <MapObjectView
      mapConfig={props.map}
      {...(isHistory(stored) ? { history: stored } : {})}
      onHistory={save}
    />
  );
}

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
  /** Таб сохраняет, где он сейчас, при каждом переходе — хранить это умеет только хост. */
  onTarget?: (target: TabTarget) => void;
}) {
  const { target, onTarget } = props;

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
            {...(isHistory(target.history) ? { history: target.history } : {})}
            onHistory={(history) => onTarget?.({ ...target, history })}
          />
        ) : (
          // Кто ждёт ответа — поверх всех карт, а не внутри одной: список общий на окно, а карт
          // в сайдбаре бывает несколько. В табе его нет: таб открыт на одном объекте (0034).
          <>
            <Maps renderMap={(map) => <SidebarObject map={map} />} />
            <DirectiveTurns />
          </>
        )}
      </ProviderIcons>
    </ProviderBridgeClient>
  );
}
