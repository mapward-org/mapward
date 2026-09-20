import { useState } from "react";
import { linkKind } from "@mapward/core";
import { findObject, trail } from "@mapward/core";
import { useMap, useMapActions } from "../adapters/use-map.ts";
import { useTerminals } from "../adapters/use-terminals.ts";
import { useCapabilities } from "../adapters/use-capabilities.ts";
import { TerminalMenu } from "../ui/terminal-menu.tsx";
import { MetricGrid } from "../_metrics/compose/metric-grid.tsx";
import { ChildrenMapView } from "../_children-map/compose/children-map.tsx";
import { DirectiveList } from "../_directives/compose/directive-list.tsx";
import { MetaScreen } from "../_meta/compose/meta-screen.tsx";
import { activeDirectives, newestFirst } from "../pure-model/directives.ts";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import {
  ActionsIcon,
  DirectivesIcon,
  IndexIcon,
  MetaIcon,
  MetricsIcon,
  NewDirectiveIcon,
  WorkflowIcon,
} from "../ui/icons.tsx";
import { HeaderButton, ObjectHeader } from "../ui/object-header.tsx";
import { Loading } from "../../../lib/ui/loading.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/** Иконки разделов мета-экрана: те же, что стояли на кнопках этих списков в шапке. */
const metaIcons = {
  index: IndexIcon,
  metrics: MetricsIcon,
  directives: DirectivesIcon,
  workflow: WorkflowIcon,
  actions: ActionsIcon,
};

export function MapObjectView(props: { mapConfig: Ref }) {
  const map = useMap(props.mapConfig);
  const actions = useMapActions();
  // Where you are belongs to the map you are looking at: switching maps starts over.
  const [address, setAddress] = useState<string>();
  /**
   * Второй режим того же объекта, а не вторая панель: мета-информация показывается вместо
   * сетки метрик и уходит по «назад» — решение 0024. Состояние React, а не состояние вида:
   * переживать перезапуск ему незачем, а возвращаться на метрики при переходе — нужно.
   */
  const [meta, setMeta] = useState(false);
  const terminals = useTerminals(props.mapConfig, address ?? "mapward://");
  // Клиент рисует только то, что хост обещал уметь — решение 0014.
  const can = useCapabilities();

  if (!map) return <Loading text="Читаем карту…" />;

  const current = (address && findObject(map, address)) || map;
  const path = trail(map, current.address);

  const go = (next: string) => {
    setAddress(next);
    setMeta(false);
  };

  /**
   * Ссылка ведёт туда, куда обещает схема — решение 0005: `mapward://` в объект, всё прочее
   * со схемой наружу, остальное файлом в редактор. Если хост файлы открывать не умеет, ссылка
   * просто ничего не делает (решение 0014).
   */
  const open = (link: string) => {
    const kind = linkKind(link);
    if (kind === "object") go(link);
    else if (kind === "external") actions.openExternal(link);
    else if (can.openFile) actions.open(link);
  };

  const runStage = can.terminals
    ? (file: { name: string }, stage: string) => terminals.runStage(file.name, stage)
    : undefined;
  const openDirective = can.openFile
    ? (file: { path: string }) => actions.open(file.path)
    : undefined;

  return (
    <div className="flex h-full flex-col pb-2">
      <Breadcrumbs trail={path.slice(0, -1)} onGo={go} />

      <ObjectHeader
        name={current.name}
        prototypeName={current.prototypeName}
        actions={
          <>
            {can.terminals && (
              <TerminalMenu
                terminals={terminals.terminals}
                onOpen={() => terminals.open()}
                onFresh={() => terminals.open(true)}
                onShow={terminals.show}
                onClose={terminals.close}
              />
            )}
            {/*
              Шапка держит только то, что делают, а не то, что смотрят: новую директиву
              и терминал. Всё остальное об объекте — за кнопкой «об объекте» (решение 0024).
            */}
            {can.ask && (
              <HeaderButton
                title="Новая директива"
                onClick={() => actions.createDirective(current.path)}
              >
                {NewDirectiveIcon}
              </HeaderButton>
            )}
            {!meta && (
              <HeaderButton title="Об объекте" onClick={() => setMeta(true)}>
                {MetaIcon}
              </HeaderButton>
            )}
          </>
        }
      />

      {/*
        Незакрытые директивы — на первом экране, под названием и до метрик: с ними работают
        постоянно, а выполненные лежат в мета-экране (решение 0024).
      */}
      {!meta && (
        <div className="shrink-0">
          <DirectiveList
            files={activeDirectives(current.directives)}
            stages={current.workflow}
            {...(openDirective === undefined ? {} : { onOpen: openDirective })}
            {...(runStage === undefined ? {} : { onRunStage: runStage })}
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {meta ? (
          <MetaScreen
            map={map}
            object={current}
            can={can}
            icons={metaIcons}
            actions={actions}
            onBack={() => setMeta(false)}
            directives={
              <DirectiveList
                files={newestFirst(current.directives)}
                stages={current.workflow}
                {...(openDirective === undefined ? {} : { onOpen: openDirective })}
                {...(runStage === undefined ? {} : { onRunStage: runStage })}
                {...(can.ask
                  ? {
                      // Спросить «точно?» умеет хост, поэтому без `ask` крестика нет:
                      // удаление — единственное необратимое, что делает этот экран (0014).
                      onRemove: (file: { name: string }) =>
                        actions.deleteDirective(current.path, file.name),
                    }
                  : {})}
              />
            }
          />
        ) : (
          <MetricGrid
            mapRef={props.mapConfig}
            object={current}
            onOpen={open}
            renderMap={(childrenMap, metricAddress) => (
              <ChildrenMapView
                map={childrenMap}
                mapPath={props.mapConfig.mapPath}
                address={metricAddress}
                onOpen={open}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
