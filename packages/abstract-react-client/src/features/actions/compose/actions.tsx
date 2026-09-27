import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";
import type { ActionRef, MapAction, MapObject } from "@mapward/core";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { Floating } from "../../../lib/ui/floating.tsx";
import { MenuStore } from "../model/menu-store.ts";
import { RowMenuStore } from "../model/row-menu-store.ts";
import { useActions } from "../ports.tsx";
import { ActionButton, ActionRunning, RowActionButton } from "../ui/action-button.tsx";
import {
  ActionFormFrame,
  CheckboxControl,
  ChoiceControl,
  ConfirmButtons,
  ConfirmQuestion,
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
  MissingActionItem,
  RowMenuButton,
  RowMenuFrame,
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

  return launcher.question !== undefined ? (
    <ActionFormFrame onSubmit={() => launcher.confirm()} onCancel={() => launcher.cancel()}>
      <FormHead title={launcher.title} />
      <ConfirmQuestion text={launcher.question} />
      {launcher.notes.map((note) => (
        <FormNote key={note} text={note} />
      ))}
      <ConfirmButtons
        label={launcher.title}
        sending={launcher.sending}
        onCancel={() => launcher.cancel()}
      />
    </ActionFormFrame>
  ) : launcher.opened ? (
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

/**
 * Меню строки списка или узла дерева — экшоны из `actions` строки: кнопкой «⋯» и правым кликом.
 * Запуск тем же путём, что у кнопки строки; экшона нет — ошибка своего пункта, а не строки.
 */
export const RowActionMenuFor = observer(function RowActionMenuFor(props: {
  object: MapObject;
  actions: ActionRef[];
  children: ReactNode;
}) {
  const actions = useActions();
  const menu = useLocalStore(
    () => new RowMenuStore((ref) => actions.launchRef(props.object, ref)),
    [props.object],
  );

  return (
    <RowMenuFrame
      hold={menu.popup.hold}
      onContextMenu={(x, y) => menu.openAt(x, y)}
      button={<RowMenuButton open={menu.popup.open} onToggle={(button) => menu.toggle(button)} />}
    >
      {props.children}
      {menu.popup.open && (
        <Floating at={menu.anchor.at} hold={menu.popup.holdLayer}>
          <ActionMenuPanel>
            <ActionList empty={false}>
              {actions
                .menuFor(props.object, props.actions)
                .map((entry) =>
                  entry.action ? (
                    <ActionItem
                      key={entry.key}
                      action={entry.action}
                      running={actions.running(entry.action.address)}
                      owner={false}
                      onSelect={() => menu.select(entry.ref)}
                    />
                  ) : (
                    <MissingActionItem key={entry.key} run={entry.ref.run} />
                  ),
                )}
            </ActionList>
          </ActionMenuPanel>
        </Floating>
      )}
    </RowMenuFrame>
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
