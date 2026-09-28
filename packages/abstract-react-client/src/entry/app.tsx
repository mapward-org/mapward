import { observer } from "mobx-react-lite";
import type { BridgeClient } from "@mapward/core";
import type { AppBridge } from "@mapward/core";
import { ProviderBridgeClient } from "../ports/bridge.tsx";
import { ProviderIcons, type RenderIcon } from "../ports/icons.tsx";
import { Host } from "../services/host/adapters/host.ts";
import { ProvideHost, useHost } from "../services/host/ports.tsx";
import { ViewStates } from "../services/state/index.ts";
import { ProvideViewStates, useViewStates } from "../services/state/ports.tsx";
import { LiveFiles } from "@mapward/core";
import { bridgeFiles, MapView, MapViews, reloadMap } from "../services/map/index.ts";
import { ProvideMapViews, useMapViews } from "../services/map/ports.tsx";
import { useLocalStore } from "../lib/mobx/use-local-store.ts";
import { Loading } from "../lib/ui/loading.tsx";
import { Maps } from "../features/maps/index.ts";
import {
  MapFrames,
  SavedHistory,
  TabHistory,
  type History,
} from "../features/object-screen/index.ts";
import { DirectiveTurns } from "../features/directive-turns/index.ts";
import { FocusInbox } from "../features/focus/index.ts";
import { ObjectView } from "./object-view.tsx";
import type { StartAt } from "../features/object-screen/index.ts";

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
const SidebarObject = observer(function SidebarObject(props: { map: MapRef; focus: FocusInbox }) {
  const views = useViewStates();
  const saved = useLocalStore(
    () => new SavedHistory(views, props.map.mapPath),
    [props.map.mapPath],
  );

  return saved.ready ? (
    <FramedObject map={props.map} history={saved.history} persist={saved} focus={props.focus} />
  ) : (
    <Loading text="Читаем карту…" />
  );
});

/**
 * Вид объекта кадрами — переход в подключённую карту на месте (решение о подключённых картах):
 * объект проекта открывается новым кадром со своей картой, «назад» с его начала возвращает в
 * прежний. Хранится история только нижнего кадра — карты, на которой вид открыт.
 */
const FramedObject = observer(function FramedObject(props: {
  map: MapRef;
  start?: StartAt;
  history: History | undefined;
  persist: { save(history: History): void };
  focus?: FocusInbox;
}) {
  const maps = useMapViews();
  const frames = useLocalStore(
    () =>
      new MapFrames(
        { map: props.map, history: props.history, ...(props.start ? { start: props.start } : {}) },
        (from, mount) => maps.mounted(from, mount),
        (history) => props.persist.save(history),
      ),
    [props.map.mapPath, maps],
  );

  return (
    <ObjectView
      key={frames.key}
      mapConfig={frames.top.map}
      start={frames.top.start}
      history={frames.top.history}
      onHistory={(history) => frames.save(history)}
      focus={props.focus}
      frames={frames}
    />
  );
});

/**
 * Объект в табе: карта, место и история приезжают от хоста, а не из сайдбара. Каждый переход
 * таб сохраняет у себя и сообщает хосту — тот переписывает имя вкладки (решения 0026 и 0036).
 */
const TabObject = observer(function TabObject(props: {
  target: TabTarget;
  onTarget?: (target: TabTarget) => void;
}) {
  const host = useHost();
  const { target } = props;
  const tab = useLocalStore(
    () => new TabHistory(target, host, props.onTarget),
    [target, host, props.onTarget],
  );

  return (
    <FramedObject
      map={{ mapPath: target.mapPath, basePath: target.basePath, name: target.name }}
      start={{
        address: target.address,
        ...(target.group === undefined ? {} : { group: target.group }),
        ...(target.metric === undefined ? {} : { metric: target.metric }),
      }}
      history={target.history}
      persist={tab}
    />
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
  // Живая карта собирается здесь: у фич есть только мост, а файлы по нему — у сервиса карты.
  const maps = useLocalStore(
    () =>
      new MapViews(
        props.client,
        (ref, mounts) =>
          new MapView(
            new LiveFiles(bridgeFiles(props.client, ref)),
            ref,
            () => reloadMap(props.client, ref),
            mounts,
          ),
      ),
    [props.client],
  );
  const { target, onTarget } = props;
  // Просьбы «перейди к объекту» слушает только сайдбар: таб хост поднимает сам.
  const focus = useLocalStore(() => new FocusInbox(props.client), [props.client]);

  return (
    <ProviderBridgeClient client={props.client}>
      <ProviderIcons render={props.icon}>
        <ProvideHost host={host}>
          <ProvideViewStates states={views}>
            <ProvideMapViews views={maps}>
              {target ? (
                <TabObject target={target} {...(onTarget ? { onTarget } : {})} />
              ) : (
                // Лента — поверх всех карт, а не внутри одной: она общая на окно, а карт в
                // сайдбаре бывает несколько. В табе её нет (решение 0034). Пункт экшона ведёт
                // той же просьбой «перейди к объекту», что кнопка в файле директивы.
                <>
                  <Maps
                    renderMap={(map) => <SidebarObject map={map} focus={focus} />}
                    focus={focus}
                  />
                  <DirectiveTurns focus={focus} />
                </>
              )}
            </ProvideMapViews>
          </ProvideViewStates>
        </ProvideHost>
      </ProviderIcons>
    </ProviderBridgeClient>
  );
});
