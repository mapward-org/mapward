import type { MapObject } from "@mapward/core";
import { useLocalStore } from "../../../lib/store/use-local-store.ts";
import { useWatch } from "../../../lib/store/use-watch.ts";
import { Floating } from "../../../lib/ui/floating.tsx";
import { MenuStore } from "../model/menu-store.ts";
import { useActionFormView, useActions } from "../ports.tsx";
import {
  ActionComponentFrame,
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
} from "../ui/action-menu.tsx";

/** Меню всех экшонов объекта в шапке, с поиском — решение 0038. */
export function ObjectActionMenu(props: { object: MapObject }) {
  const actions = useActions();
  const menu = useLocalStore(
    () =>
      new MenuStore(
        () => props.object.actions,
        (action) => actions.launch(action),
      ),
    [props.object],
  );
  useWatch(actions, menu);

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
}

/**
 * Форма запуска поверх экрана — решение 0038: лежит поверх вида, а не окном редактора, и одна
 * на все кнопки. Пока ничего не запускают — её нет.
 */
export function ActionFormHost() {
  const { launcher } = useActions();
  const View = useActionFormView();
  useWatch(launcher);

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
  ) : launcher.opened && launcher.componentProps && launcher.component !== undefined && View ? (
    // Своя форма экшона: рамку, заголовок и ошибки рисует карта, поля и кнопки — компонент.
    <ActionComponentFrame onCancel={() => launcher.cancel()}>
      <FormHead title={launcher.title} description={launcher.description} />
      {launcher.notes.map((note) => (
        <FormNote key={note} text={note} />
      ))}
      <View action={launcher.opened.action.address} props={launcher.componentProps} />
    </ActionComponentFrame>
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
}
