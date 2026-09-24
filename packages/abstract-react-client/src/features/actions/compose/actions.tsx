import { observer } from "mobx-react-lite";
import type { ActionRef, MapAction, MapObject } from "@mapward/core";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { Floating } from "../../../lib/ui/floating.tsx";
import { MenuStore } from "../model/menu-store.ts";
import { useActions } from "../ports.tsx";
import { ActionButton, ActionRunning, RowActionButton } from "../ui/action-button.tsx";
import {
  ActionFormFrame,
  CheckboxControl,
  ChoiceControl,
  FormButtons,
  FormField,
  FormHead,
  FormNote,
  TextControl,
} from "../ui/action-form.tsx";
import {
  ActionItem,
  ActionList,
  ActionMenuBox,
  ActionMenuButton,
  ActionMenuPanel,
  ActionSearch,
} from "../ui/action-menu.tsx";

/** Меню всех экшонов объекта в шапке, с поиском — решение 0038. */
export const ObjectActionMenu = observer(function ObjectActionMenu(props: { object: MapObject }) {
  const actions = useActions();
  const menu = useLocalStore(
    () =>
      new MenuStore(
        () => props.object.actions,
        (action) => actions.launch(action),
      ),
    [props.object],
  );

  return (
    <ActionMenuBox hold={menu.popup.hold}>
      <ActionMenuButton onToggle={(button) => menu.toggle(button)} />
      {menu.popup.open && (
        <Floating at={menu.anchor.at} hold={menu.popup.holdLayer}>
          <ActionMenuPanel>
            <ActionSearch
              query={menu.query}
              onQuery={(query) => menu.setQuery(query)}
              onClose={() => menu.popup.close()}
              onFirst={() => menu.runFirst()}
            />
            <ActionList empty={menu.found.length === 0}>
              {menu.found.map((action) => (
                <ActionItem
                  key={action.address}
                  action={action}
                  running={actions.running(action.address)}
                  onSelect={(one) => menu.select(one)}
                />
              ))}
            </ActionList>
          </ActionMenuPanel>
        </Floating>
      )}
    </ActionMenuBox>
  );
});

/**
 * Форма запуска поверх экрана — решение 0038: лежит поверх вида, а не окном редактора, и одна
 * на все кнопки. Пока ничего не запускают — её нет.
 */
export const ActionFormHost = observer(function ActionFormHost() {
  const { launcher } = useActions();

  return launcher.opened ? (
    <ActionFormFrame onSubmit={() => launcher.submit()} onCancel={() => launcher.cancel()}>
      <FormHead title={launcher.title} description={launcher.description} />
      {launcher.notes.map((note) => (
        <FormNote key={note} text={note} />
      ))}
      {launcher.fields.map((field) => (
        <FormField
          key={field.name}
          field={field}
          control={
            field.kind === "boolean" ? (
              <CheckboxControl
                field={field}
                onChange={(value) => launcher.change(field.name, value)}
              />
            ) : field.kind === "choice" ? (
              <ChoiceControl
                field={field}
                onChange={(value) => launcher.change(field.name, value)}
              />
            ) : (
              <TextControl field={field} onChange={(value) => launcher.change(field.name, value)} />
            )
          }
        />
      ))}
      <FormButtons
        sending={launcher.opened.sending}
        confirm={launcher.fields.length === 0}
        onCancel={() => launcher.cancel()}
      />
    </ActionFormFrame>
  ) : null;
});

/**
 * Кнопка экшона в клетке раскладки — решение 0038: ключ экшона в `areas` ставит её так же, как
 * ключ метрики ставит метрику.
 */
export const CellActionButton = observer(function CellActionButton(props: { action: MapAction }) {
  const actions = useActions();
  return (
    <ActionButton
      {...actions.button(props.action)}
      counter={<ActionRunning count={actions.running(props.action.address)} />}
      onRun={() => actions.launch(props.action)}
    />
  );
});

/** Кнопка экшона на строке списка или узле дерева: строка называет экшон ключом или адресом. */
export const RowActionButtonFor = observer(function RowActionButtonFor(props: {
  object: MapObject;
  action: ActionRef;
}) {
  const actions = useActions();
  return (
    <RowActionButton
      {...actions.buttonFor(props.object, props.action)}
      counter={<ActionRunning count={actions.runningFor(props.object, props.action)} />}
      onRun={() => actions.launchRef(props.object, props.action)}
    />
  );
});

/** `ActionButton` набора `@mapward/display` для компонента-дисплея. */
export const KitActionButton = observer(function KitActionButton(props: {
  object: MapObject;
  action: ActionRef;
  label?: string | undefined;
}) {
  const actions = useActions();
  return (
    <ActionButton
      {...actions.buttonFor(props.object, props.action, props.label)}
      counter={<ActionRunning count={actions.runningFor(props.object, props.action)} />}
      onRun={() => actions.launchRef(props.object, props.action)}
    />
  );
});
