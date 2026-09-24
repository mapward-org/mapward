import { observer } from "mobx-react-lite";
import type { MapFile, MapObject } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { Floating } from "../../../lib/ui/floating.tsx";
import { DirectivesIcon, NewDirectiveIcon } from "../../../lib/ui/icons.tsx";
import { Section, SectionButton } from "../../../lib/ui/section.tsx";
import { DirectiveFiles } from "../adapters/directive-files.ts";
import { DirectiveMenuStore } from "../model/directive-menu.ts";
import { DirectivesView } from "../model/directives-view.ts";
import { useDirectivesPort } from "../ports.tsx";
import { DirectiveEmpty, DirectiveList } from "../ui/directive-list.tsx";
import {
  DirectiveMenuBox,
  DirectiveMenuButton,
  DirectiveMenuPanel,
  DirectiveSearch,
  StageItem,
  StageList,
} from "../ui/directive-menu.tsx";
import { DirectiveRow } from "../ui/directive-row.tsx";

/**
 * Незакрытые директивы объекта — на первом экране (решение 0024). Плюсик в заголовке заводит
 * новую — решение 0028; без хоста, который спросит имя, плюсика нет.
 */
export const ObjectDirectives = observer(function ObjectDirectives(props: { object: MapObject }) {
  const port = useDirectivesPort();
  const bridge = useBridgeClient();
  const view = useLocalStore(
    () => new DirectivesView(() => props.object, new DirectiveFiles(bridge)),
    [props.object],
  );

  return (
    <Section
      icon={DirectivesIcon}
      title="Директивы"
      {...(port.ask
        ? {
            actions: (
              <SectionButton title="Новая директива" onClick={() => view.create()}>
                {NewDirectiveIcon}
              </SectionButton>
            ),
          }
        : {})}
    >
      {view.active.length === 0 ? (
        <DirectiveEmpty text="незакрытых нет" />
      ) : (
        <DirectiveList compact>
          {view.active.map((file) => (
            <DirectiveRow
              key={file.path}
              file={file}
              stages={view.stages}
              onOpen={port.open}
              onRunStage={
                port.runStage && ((one, stage) => port.runStage?.(props.object, one, stage))
              }
            />
          ))}
        </DirectiveList>
      )}
    </Section>
  );
});

/**
 * Раздел «Директивы» мета-экрана: все, свежие сверху. Своего поиска у него нет: поиск один на
 * весь экран, и сюда приходит уже отобранный список. Удалять отсюда можно, но только если хост
 * умеет спросить «точно?»: удаление — единственное необратимое на этом экране (0014).
 */
export const DirectiveArchive = observer(function DirectiveArchive(props: {
  object: MapObject;
  files: MapFile[];
}) {
  const port = useDirectivesPort();
  const bridge = useBridgeClient();
  const view = useLocalStore(
    () => new DirectivesView(() => props.object, new DirectiveFiles(bridge)),
    [props.object],
  );

  return (
    <Section icon={DirectivesIcon} title="Директивы">
      {props.files.length > 0 && (
        <DirectiveList>
          {view.archive(props.files).map((file) => (
            <DirectiveRow
              key={file.path}
              file={file}
              stages={view.stages}
              onOpen={port.open}
              onRunStage={
                port.runStage && ((one, stage) => port.runStage?.(props.object, one, stage))
              }
              onRemove={port.ask ? (one: MapFile) => view.remove(one) : undefined}
            />
          ))}
        </DirectiveList>
      )}
    </Section>
  );
});

/**
 * Директивы объекта кнопкой с поиском — в шапке карточки: пункт на пару «директива · этап»,
 * выбор отправляет фразу этапа в сессию этого объекта. Без хоста с терминалами кнопки нет.
 */
export const DirectiveMenu = observer(function DirectiveMenu(props: { object: MapObject }) {
  const port = useDirectivesPort();
  const menu = useLocalStore(
    () =>
      new DirectiveMenuStore(
        () => props.object,
        (file, stage) => port.runStage?.(props.object, file, stage),
      ),
    [props.object],
  );

  return port.runStage === undefined ? null : (
    <DirectiveMenuBox hold={menu.popup.hold}>
      <DirectiveMenuButton onToggle={(button) => menu.toggle(button)} />
      {menu.popup.open && (
        <Floating at={menu.anchor.at} hold={menu.popup.holdLayer}>
          <DirectiveMenuPanel>
            <DirectiveSearch
              query={menu.query}
              onQuery={(query) => menu.setQuery(query)}
              onClose={() => menu.popup.close()}
              onFirst={() => menu.runFirst()}
            />
            <StageList empty={menu.empty}>
              {menu.found.map((item) => (
                <StageItem
                  key={item.key}
                  label={item.label}
                  title={item.file.name}
                  busy={item.busy}
                  onSelect={() => menu.select(item)}
                />
              ))}
            </StageList>
          </DirectiveMenuPanel>
        </Floating>
      )}
    </DirectiveMenuBox>
  );
});
