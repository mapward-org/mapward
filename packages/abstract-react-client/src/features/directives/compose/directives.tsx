import { observer } from "mobx-react-lite";
import type { MapFile, MapObject } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { Floating } from "../../../lib/ui/floating.tsx";
import { DirectivesIcon } from "../../../lib/ui/icons.tsx";
import { Section } from "../../../lib/ui/section.tsx";
import { DirectiveFiles } from "../adapters/directive-files.ts";
import { DirectiveMenuStore } from "../model/directive-menu.ts";
import { DirectivesView } from "../model/directives-view.ts";
import { useDirectivesPort } from "../ports.tsx";
import { DirectiveList } from "../ui/directive-list.tsx";
import {
  DirectiveItem,
  DirectiveItems,
  DirectiveMenuBox,
  DirectiveMenuButton,
  DirectiveMenuPanel,
  DirectiveSearch,
  NewDirectiveItem,
} from "../ui/directive-menu.tsx";
import { DirectiveRow } from "../ui/directive-row.tsx";

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
 * Директивы объекта кнопкой с поиском — одна на экран и карточку (решение 0045): сверху
 * «новая», пункт на незакрытую директиву, клик открывает её файл — этапы запускают оттуда.
 * Кнопка есть всегда; чего хост не умеет, того в меню нет.
 */
export const DirectiveMenu = observer(function DirectiveMenu(props: { object: MapObject }) {
  const port = useDirectivesPort();
  const bridge = useBridgeClient();
  const view = useLocalStore(
    () => new DirectivesView(() => props.object, new DirectiveFiles(bridge)),
    [props.object],
  );
  const menu = useLocalStore(
    () =>
      new DirectiveMenuStore(
        () => props.object,
        () => port,
        () => view.create(),
      ),
    [props.object, view],
  );

  return (
    <DirectiveMenuBox hold={menu.popup.hold}>
      <DirectiveMenuButton count={menu.count} onToggle={(button) => menu.toggle(button)} />
      {menu.popup.open && (
        <Floating at={menu.anchor.at} hold={menu.popup.holdLayer}>
          <DirectiveMenuPanel>
            {menu.canCreate && <NewDirectiveItem onSelect={() => menu.create()} />}
            <DirectiveSearch
              query={menu.query}
              onQuery={(query) => menu.setQuery(query)}
              onClose={() => menu.popup.close()}
              onFirst={() => menu.openFirst()}
            />
            <DirectiveItems empty={menu.empty}>
              {menu.found.map((item) => (
                <DirectiveItem
                  key={item.file.path}
                  label={item.label}
                  title={item.file.name}
                  hint={item.hint}
                  hintClass={item.hintClass}
                  onOpen={menu.canOpen ? () => menu.open(item) : undefined}
                />
              ))}
            </DirectiveItems>
          </DirectiveMenuPanel>
        </Floating>
      )}
    </DirectiveMenuBox>
  );
});
