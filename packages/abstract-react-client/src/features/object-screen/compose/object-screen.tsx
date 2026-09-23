import { observer } from "mobx-react-lite";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { TabIcon } from "../../../lib/ui/icons.tsx";
import type { Terminals } from "../adapters/terminals.ts";
import type { ScreenStore } from "../model/screen.ts";
import { TabModifier } from "../model/tab-modifier.ts";
import { useScreenSlots } from "../ports.tsx";
import { Crumb, CrumbsBar, CrumbsGroup, HistoryArrow, ReloadButton } from "../ui/breadcrumbs.tsx";
import { GroupTabs } from "../ui/group-tabs.tsx";
import { HeaderButton, ObjectHeader } from "../ui/object-header.tsx";
import {
  ClashNote,
  DirectivesBar,
  GroupDescription,
  Reading,
  ScreenBody,
  ScreenFrame,
  SoloBar,
  SoloBody,
} from "../ui/screen-layout.tsx";
import { FreshTerminal, TerminalItem, TerminalMenu } from "../ui/terminal-menu.tsx";
import { ViewTabs } from "../ui/view-tabs.tsx";

/** Что экрану нужно от карты, кроме объектов: готова ли она и как её перечитать. */
type ScreenMapState = { ready: boolean; reloading: boolean; reload: () => void };

/**
 * Экран объекта — решения 0036 и 0042: шапка, вкладки видов, крошки, стрелки истории, меню
 * терминалов, а по местам — части, которые подкладывает точка входа. Где ты и что открыто,
 * держит стор экрана; здесь только то, что где стоит.
 */
export const ObjectScreen = observer(function ObjectScreen(props: {
  screen: ScreenStore;
  map: ScreenMapState;
  terminals: Terminals;
}) {
  const { screen, terminals } = props;
  const slots = useScreenSlots();
  // Под ctrl подсвечивается то, что откроется табом: иконок у ссылок нет — решение 0035.
  useLocalStore(() => new TabModifier(() => screen.tabs), [screen]);

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
        Виды объекта — мини-вкладками в строке истории, за стрелками: сразу видно, где ты, и
        переход из любого вида в любой — один клик. Вид шагом истории не считается (0036).
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
        <CrumbsGroup>
          <ViewTabs active={screen.view} onSelect={(view) => screen.setView(view)} />
        </CrumbsGroup>
        {screen.crumbs.map((step, index) => (
          <Crumb
            key={step.address}
            step={step}
            first={index === 0}
            onGo={(address) => screen.go(address)}
            onOpenTab={screen.objectTab}
          />
        ))}
      </CrumbsBar>

      <ObjectHeader
        name={screen.object.name}
        prototypeName={screen.object.prototypeName}
        actions={
          <>
            {/* Все экшоны объекта списком с поиском — решение 0038. Нет экшонов — нет кнопки. */}
            {screen.hasActions && <slots.ActionMenu object={screen.object} />}
            {screen.can.terminals && (
              <TerminalMenu empty={terminals.list.length === 0} onOpen={() => terminals.open()}>
                {(close) => (
                  <>
                    <FreshTerminal close={close} onFresh={() => terminals.open(true)} />
                    {terminals.list.map((terminal) => (
                      <TerminalItem
                        key={terminal.id}
                        terminal={terminal}
                        close={close}
                        onShow={(id) => terminals.show(id)}
                        onClose={(id) => terminals.close(id)}
                      />
                    ))}
                  </>
                )}
              </TerminalMenu>
            )}
            {/* Шапка держит только то, что делают, а не то, что смотрят (решение 0024). */}
            {screen.tabs && (
              <HeaderButton title="Открыть отдельным табом" onClick={() => screen.openGroupTab()}>
                {TabIcon}
              </HeaderButton>
            )}
          </>
        }
      />

      <ClashNote keys={screen.clashes} />

      {screen.plain && (
        <DirectivesBar>
          <slots.Directives object={screen.object} />
        </DirectivesBar>
      )}

      {/* Вкладки объекта и описание открытой — решение 0025. */}
      {screen.hasGroups && (
        <GroupTabs
          groups={screen.object.metricGroups}
          active={screen.groupKey ?? ""}
          onSelect={(key) => screen.setGroup(key)}
          {...(screen.tabs ? { onOpenTab: (key: string) => screen.openGroupTab(key) } : {})}
        />
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
          <slots.Metrics
            object={screen.object}
            metrics={screen.shown}
            layout={screen.layout}
            group={screen.groupKey}
          />
        )}
      </ScreenBody>
    </ScreenFrame>
  );
});
