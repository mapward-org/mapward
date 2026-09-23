import { observer } from "mobx-react-lite";
import type { BridgeClient } from "@mapward/core";
import type { AppBridge } from "@mapward/core";
import { ProviderBridgeClient } from "../ports/bridge.tsx";
import { ProviderIcons, type RenderIcon } from "../ports/icons.tsx";
import { Host } from "../services/host/adapters/host.ts";
import { ProvideHost } from "../services/host/ports.tsx";
import { ViewStates } from "../services/state/index.ts";
import { ProvideViewStates, useViewStates } from "../services/state/ports.tsx";
import { useLocalStore } from "../lib/mobx/use-local-store.ts";
import { Loading } from "../lib/ui/loading.tsx";
import { Maps } from "../features/maps/index.ts";
import { SavedHistory, type History } from "../features/object-screen/index.ts";
import { DirectiveTurns } from "../features/directive-turns/index.ts";
import { ObjectView } from "./object-view.tsx";

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
 * Объект карты в сайдбаре. История — в состоянии вида, по карте своя (решение 0036); пока
 * хранилище не ответило, объекта нет: переход раньше ответа затёрла бы пришедшая история.
 */
const SidebarObject = observer(function SidebarObject(props: { map: MapRef }) {
  const views = useViewStates();
  const saved = useLocalStore(
    () => new SavedHistory(views, props.map.mapPath),
    [props.map.mapPath],
  );

  return saved.ready ? (
    <ObjectView
      mapConfig={props.map}
      history={saved.history}
      onHistory={(history) => saved.save(history)}
    />
  ) : (
    <Loading text="Читаем карту…" />
  );
});

/**
 * Сборка клиента: карты аккордеоном, внутри объект. Мост приходит снаружи — приложение решает,
 * каким транспортом он ходит (решение 0014), а клиент знает только контракт из `core`. Хост и
 * состояние вида — одни на клиент: их заводит здесь точка входа (решение 0042).
 *
 * С `target` это тот же клиент, открытый на одном объекте: списка карт в табе нет — карту в нём
 * уже выбрали, и выбор её заново означал бы второй сайдбар внутри таба (решение 0026).
 */
export const MapwardApp = observer(function MapwardApp(props: {
  client: BridgeClient<AppBridge>;
  icon?: RenderIcon;
  target?: TabTarget;
  /** Таб сохраняет, где он сейчас, при каждом переходе — хранить это умеет только хост. */
  onTarget?: (target: TabTarget) => void;
}) {
  const host = useLocalStore(() => new Host(props.client), [props.client]);
  const views = useLocalStore(() => new ViewStates(props.client), [props.client]);
  const { target, onTarget } = props;

  return (
    <ProviderBridgeClient client={props.client}>
      <ProviderIcons render={props.icon}>
        <ProvideHost host={host}>
          <ProvideViewStates states={views}>
            {target ? (
              <ObjectView
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
                history={target.history}
                onHistory={(history) => onTarget?.({ ...target, history })}
              />
            ) : (
              // Кто ждёт ответа — поверх всех карт, а не внутри одной: список общий на окно,
              // а карт в сайдбаре бывает несколько. В табе его нет (решение 0034).
              <>
                <Maps renderMap={(map) => <SidebarObject map={map} />} />
                <DirectiveTurns />
              </>
            )}
          </ProvideViewStates>
        </ProvideHost>
      </ProviderIcons>
    </ProviderBridgeClient>
  );
});
