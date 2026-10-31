import type { Watchable } from "../../../lib/store/reactive.ts";
import { useLocalStore } from "../../../lib/store/use-local-store.ts";
import { useWatch } from "../../../lib/store/use-watch.ts";
import { TabIcon } from "../../../lib/ui/icons.tsx";
import type { Terminals } from "../adapters/terminals.ts";
import type { ScreenStore } from "../model/screen.ts";
import { TabModifier } from "../model/tab-modifier.ts";
import { TabsRow } from "../model/tabs-row.ts";
import { useScreenSlots } from "../ports.tsx";
import {
  Crumb,
  CrumbsBar,
  CrumbsGroup,
  CrumbsPath,
  HistoryArrow,
  ReloadButton,
} from "../ui/breadcrumbs.tsx";
import { GroupTab, GroupTabs } from "../ui/group-tabs.tsx";
import { HeaderTabButton, ObjectHeader } from "../ui/object-header.tsx";
import {
  GroupDescription,
  Reading,
  ScreenBody,
  ScreenFrame,
  SoloBar,
  SoloBody,
} from "../ui/screen-layout.tsx";
import { ViewTabs } from "../ui/view-tabs.tsx";
import { ObjectTerminalMenu } from "./terminal-menu.tsx";

/** Что экрану нужно от карты, кроме объектов: готова ли она и как её перечитать. */
type ScreenMapState = Watchable & { ready: boolean; reloading: boolean; reload: () => void };

/**
 * Экран объекта — решения 0036 и 0042: шапка, вкладки видов, крошки, стрелки истории, меню
 * терминалов, а по местам — части, которые подкладывает точка входа. Где ты и что открыто,
 * держит стор экрана; здесь только то, что где стоит.
 */
export function ObjectScreen(props: {
  screen: ScreenStore;
  map: ScreenMapState;
  terminals: Terminals;
}) {
  const { screen, terminals } = props;
  const slots = useScreenSlots();
  // Под ctrl подсвечивается то, что откроется табом: иконок у ссылок нет — решение 0035.
  useLocalStore(() => new TabModifier(screen, () => screen.tabs), [screen]);
  const tabsRow = useLocalStore(() => new TabsRow(screen, () => screen.groupKey), [screen]);
  useWatch(screen, props.map, tabsRow);

  return !props.map.ready ? (
    <Reading />
  ) : screen.soloMetric ? (
    <ScreenFrame>
      <slots.ActionForm />
      <SoloBar
        object={screen.object.name}
        metric={screen.soloLabel}
        onBack={() => screen.showObject()}
      />
      <SoloBody>
        <slots.Metrics
          object={screen.object}
          metrics={[screen.soloMetric]}
          solo={screen.soloMetric.key}
        />
      </SoloBody>
    </ScreenFrame>
  ) : (
    <ScreenFrame>
      <slots.ActionForm />
      {/*
        Верх экрана — три строки (решение 0045): навигация с видами иконками, путь из предков,
        имя с кнопками. Вид шагом истории не считается (0036).
      */}
      <CrumbsBar>
        <CrumbsGroup>
          <HistoryArrow target={screen.back} sign="←" label="Назад" onOpenTab={screen.objectTab} />
          <HistoryArrow
            target={screen.forward}
            sign="→"
            label="Вперёд"
            onOpenTab={screen.objectTab}
          />
          <ReloadButton reloading={props.map.reloading} onReload={() => props.map.reload()} />
        </CrumbsGroup>
        <ViewTabs active={screen.view} onSelect={(view) => screen.setView(view)} />
      </CrumbsBar>
      {screen.crumbs.length > 0 && (
        <CrumbsPath>
          {screen.crumbs.map((step) => (
            <Crumb
              key={step.address}
              step={step}
              onGo={(address) => screen.go(address)}
              onOpenTab={screen.objectTab}
            />
          ))}
        </CrumbsPath>
      )}

      <ObjectHeader
        name={screen.object.name}
        prototypeName={screen.object.prototypeName}
        aside={
          // Таб — рядом с именем и по наведению на строку: кнопка про этот объект и не шумит (0045).
          screen.tabs && (
            <HeaderTabButton title="Открыть отдельным табом" onClick={() => screen.openGroupTab()}>
              {TabIcon}
            </HeaderTabButton>
          )
        }
        actions={
          <>
            {/* Незакрытые директивы — кнопкой с числом, списком не висят (решение 0045). */}
            <slots.Directives object={screen.object} />
            {/* Все экшоны объекта списком с поиском — решение 0038. Нет экшонов — нет кнопки. */}
            {screen.hasActions && <slots.ActionMenu object={screen.object} />}
            {screen.can.terminals && (
              <ObjectTerminalMenu object={screen.object} terminals={terminals} />
            )}
          </>
        }
      />

      {/* Вкладки объекта и описание открытой — решение 0025. */}
      {screen.hasGroups && (
        <GroupTabs hold={tabsRow.hold} moreLeft={tabsRow.moreLeft} moreRight={tabsRow.moreRight}>
          {screen.object.metricGroups.map((group) => (
            <GroupTab
              key={group.key}
              group={group}
              active={group.key === screen.groupKey}
              onSelect={(key) => screen.setGroup(key)}
              onOpenTab={screen.groupTab}
            />
          ))}
        </GroupTabs>
      )}
      {screen.groupDescription && (
        <GroupDescription>
          <slots.Markdown text={screen.groupDescription} onOpen={(link) => screen.open(link)} />
        </GroupDescription>
      )}

      <ScreenBody>
        {screen.runsOpen ? (
          <slots.Runs selected={screen.selectedRun} onSelect={(id) => screen.openRuns(id)} />
        ) : screen.meta ? (
          // Другой объект — другой экран: запрос поиска с прошлого сюда не переезжает.
          <slots.Meta key={screen.object.address} object={screen.object} />
        ) : (
          <slots.Metrics object={screen.object} metrics={screen.shown} group={screen.openGroup} />
        )}
      </ScreenBody>
    </ScreenFrame>
  );
}
