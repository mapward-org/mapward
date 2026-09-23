import { useCallback, useState, type ReactNode } from "react";
import type { MapAction, RunSource } from "@mapward/core";
import { useRunAction } from "../adapters/use-run-action.ts";
import {
  actionLabel,
  formPayload,
  needsForm,
  startValues,
  strayErrors,
  type FormValue,
  type FormValues,
} from "../pure-model/actions.ts";
import { ActionForm } from "../ui/action-form.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

type Open = {
  action: MapAction;
  given: Record<string, unknown>;
  source: RunSource;
  values: FormValues;
  errors: Record<string, string>;
  failed?: string;
  sending: boolean;
};

export type Launch = (
  action: MapAction,
  given?: Record<string, unknown>,
  source?: RunSource,
) => void;

/**
 * Запуск экшона — один путь для шапки, клетки раскладки, строки дисплея и компонента
 * (решение 0038): всё обязательное заполнено и `confirm` не просили — сразу, иначе форма с
 * переданными значениями. Сервер нашёл ошибки в полях — форма открывается с ними, даже если
 * запускали без неё.
 *
 * Возвращает `launch` и саму форму: где её положить, решает вид — поверх себя.
 */
export function useActionLauncher(mapRef: Ref): { launch: Launch; form: ReactNode } {
  const runAction = useRunAction(mapRef);
  const [open, setOpen] = useState<Open | undefined>(undefined);

  const send = useCallback(
    async (state: Open, inputs: Record<string, unknown>) => {
      const started = await runAction(state.action.address, inputs, state.source);
      const errors = started.errors ?? {};
      if (started.failed === undefined && Object.keys(errors).length === 0) {
        setOpen(undefined);
        return;
      }
      setOpen({
        ...state,
        errors,
        sending: false,
        ...(started.failed === undefined ? {} : { failed: started.failed }),
      });
    },
    [runAction],
  );

  const launch: Launch = useCallback(
    (action, given = {}, source = "ui") => {
      const state: Open = {
        action,
        given,
        source,
        values: startValues(action.config.inputs, given),
        errors: {},
        sending: false,
      };
      if (needsForm(action, given)) setOpen(state);
      // Без формы — переданное как есть: умолчания подставит сервер, он же их и проверит.
      else void send(state, given);
    },
    [send],
  );

  const cancel = useCallback(() => setOpen(undefined), []);

  const form = open && (
    <ActionForm
      title={actionLabel(open.action)}
      {...(open.action.config.description === undefined
        ? {}
        : { description: open.action.config.description })}
      inputs={open.action.config.inputs ?? {}}
      values={open.values}
      errors={open.errors}
      notes={[
        ...(open.failed === undefined ? [] : [open.failed]),
        ...strayErrors(open.action.config.inputs, open.errors),
      ]}
      sending={open.sending}
      onChange={(name: string, value: FormValue) =>
        setOpen({ ...open, values: { ...open.values, [name]: value } })
      }
      onSubmit={() => {
        const sending = { ...open, sending: true };
        setOpen(sending);
        void send(sending, formPayload(open.action.config.inputs, open.values, open.given));
      }}
      onCancel={cancel}
    />
  );

  return { launch, form };
}
