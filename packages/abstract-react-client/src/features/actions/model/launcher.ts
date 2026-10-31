import { distinctUntilChanged, map, type Subscription } from "rxjs";
import { actionForm, confirmQuestion } from "@mapward/core";
import type { ActionInput, MapAction, RunSource, RunStarted } from "@mapward/core";
import {
  actionLabel,
  formFields,
  formPayload,
  needsForm,
  startValues,
  strayErrors,
  type FormField,
  type FormValue,
  type FormValues,
} from "../pure-model/actions.ts";
import type { ActionFormProps } from "@mapward/component";
import { Reactive, type State } from "../../../lib/store/reactive.ts";

/** Чем запускать: ответ приходит сразу, до конца прогона (решение 0038). */
export type LaunchRunner = {
  /**
   * Поля формы экшона: `inputs` или схема его метода — её знает только плагин. Сама схема —
   * для своей формы экшона (`component`).
   */
  form(action: MapAction): Promise<{ fields: Record<string, ActionInput>; schema?: unknown }>;
  run(
    action: string,
    inputs: Record<string, unknown>,
    source: RunSource,
  ): Promise<RunStarted & { failed?: string }>;
};

/** Вопрос перед запуском — и то, что уйдёт серверу, если на него ответят «да». */
type Asking = { question: string; payload: Record<string, unknown> };

/** Открытая форма запуска или вопрос перед ним. */
type Open = {
  action: MapAction;
  /** Поля формы: `inputs` экшона или схема его метода. */
  form: Record<string, ActionInput>;
  /** JSON-схема параметров метода, если форма из неё. */
  schema?: unknown;
  given: Record<string, unknown>;
  source: RunSource;
  values: FormValues;
  errors: Record<string, string>;
  failed?: string;
  sending: boolean;
  asking?: Asking | undefined;
};

/**
 * Запуск экшона — один путь для шапки, кнопки набора, строки дисплея и компонента
 * (решение 0038): всё обязательное заполнено и `confirm` не просили — сразу, иначе форма с
 * переданными значениями. `confirm` текстом — вопрос отдельным окном перед самым запуском,
 * после формы, если она была. Сервер нашёл ошибки в полях — форма открывается с ними, даже если
 * запускали без неё. Escape закрывает форму и вопрос, как клик мимо них.
 */
export class Launcher extends Reactive {
  private readonly current: State<Open | undefined> = this.state<Open | undefined>(undefined);
  private stop: Subscription | undefined;
  private listening: (() => void) | undefined;

  constructor(private readonly runner: LaunchRunner) {
    super();
  }

  /** Открытая форма или вопрос; ничего не запускают — `undefined`. */
  get opened(): Open | undefined {
    return this.current.value;
  }

  launch(target: MapAction, given: Record<string, unknown> = {}, source: RunSource = "ui"): void {
    // Написанные `inputs` известны сразу; форму по схеме метода знает только плагин.
    if (target.config.inputs !== undefined || target.config.plugin === undefined) {
      this.begin(target, { fields: actionForm(target.config) }, given, source);
      return;
    }
    this.runner.form(target).then(
      (form) => this.begin(target, form, given, source),
      (error: unknown) =>
        this.current.set({
          action: target,
          form: {},
          given,
          source,
          values: {},
          errors: {},
          sending: false,
          failed: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  private begin(
    target: MapAction,
    { fields, schema }: { fields: Record<string, ActionInput>; schema?: unknown },
    given: Record<string, unknown>,
    source: RunSource,
  ): void {
    const state: Open = {
      action: target,
      form: fields,
      ...(schema === undefined ? {} : { schema }),
      given,
      source,
      values: startValues(fields, given),
      errors: {},
      sending: false,
    };
    // Своя форма открывается всегда: автор написал её, чтобы её видели.
    if (target.config.component !== undefined || needsForm(target, given, fields)) {
      this.current.set(state);
    }
    // Без формы — переданное как есть: умолчания подставит сервер, он же их и проверит.
    else this.ask(state, given);
  }

  change(name: string, value: FormValue): void {
    if (!this.opened) return;
    this.current.set({ ...this.opened, values: { ...this.opened.values, [name]: value } });
  }

  submit(): void {
    const open = this.opened;
    if (!open) return;
    this.ask(open, formPayload(open.form, open.values, open.given));
  }

  /**
   * Отправка своей формы экшона: её значения поверх переданных запуском. Дальше — тот же путь:
   * вопрос, если есть, и запуск; ошибки полей сервер вернёт в `errors` пропсов формы.
   */
  submitValues(values: Record<string, unknown>): void {
    const open = this.opened;
    if (!open) return;
    this.ask(open, { ...open.given, ...values });
  }

  /** «Да» на вопрос перед запуском: уходит то, о чём спрашивали. */
  confirm(): void {
    const open = this.opened;
    if (!open?.asking) return;
    const sending = { ...open, sending: true };
    this.current.set(sending);
    void this.send(sending, open.asking.payload);
  }

  cancel(): void {
    this.current.set(undefined);
  }

  /** Есть вопрос — сначала он, с подставленными данными формы; нет — запуск сразу. */
  private ask(state: Open, payload: Record<string, unknown>): void {
    const question = confirmQuestion(state.action.config, payload, state.form);
    if (question !== undefined) {
      this.current.set({ ...state, errors: {}, asking: { question, payload } });
      return;
    }
    const sending = { ...state, sending: true };
    // Из формы — она ждёт ответа сервера; без формы на экране ничего не открывалось.
    if (this.opened === state) this.current.set(sending);
    void this.send(sending, payload);
  }

  // То, что форма показывает, — готовым: подпись, описание, поля, ошибки.

  get title(): string {
    return this.opened ? actionLabel(this.opened.action) : "";
  }

  /** Вопрос перед запуском, если его задают сейчас. */
  get question(): string | undefined {
    return this.opened?.asking?.question;
  }

  get sending(): boolean {
    return this.opened?.sending === true;
  }

  get description(): string | undefined {
    return this.opened?.action.config.description;
  }

  /** Своя форма открытого экшона — путь её `.tsx`; нет — форма по полям. */
  get component(): string | undefined {
    return this.opened?.action.config.component;
  }

  private props: { open: Open; value: ActionFormProps } | undefined;

  /**
   * Пропсы своей формы — `ActionFormProps` набора. Объект один, пока форма та же: он уходит в
   * компонент, и новый на каждый кадр перерисовывал бы его зря.
   */
  get componentProps(): ActionFormProps | undefined {
    const open = this.opened;
    if (!open) return undefined;
    if (this.props?.open === open) return this.props.value;
    const config = open.action.config;
    const value: ActionFormProps = {
      params: open.values,
      schema: open.schema,
      fields: open.form,
      errors: open.errors,
      sending: open.sending,
      action: {
        key: open.action.key,
        address: open.action.address,
        label: actionLabel(open.action),
        ...(config.description === undefined ? {} : { description: config.description }),
      },
      submit: (values) => this.submitValues(values),
      cancel: () => this.cancel(),
    };
    this.props = { open, value };
    return value;
  }

  get inputs(): Record<string, ActionInput> {
    return this.opened?.form ?? {};
  }

  get fields(): FormField[] {
    const open = this.opened;
    return open ? formFields(this.inputs, open.values, open.errors) : [];
  }

  /** Что сказать над полями: отказ сервера и ошибки по полям, которых в форме нет. */
  get notes(): string[] {
    const open = this.opened;
    if (!open) return [];
    return [
      ...(open.failed === undefined ? [] : [open.failed]),
      ...strayErrors(open.form, open.errors),
    ];
  }

  mount(): void {
    this.stop = this.current.value$
      .pipe(
        map((open) => open !== undefined),
        distinctUntilChanged(),
      )
      .subscribe((open) => (open ? this.listen() : this.unlisten()));
  }

  unmount(): void {
    this.stop?.unsubscribe();
    this.unlisten();
  }

  private async send(state: Open, inputs: Record<string, unknown>): Promise<void> {
    const started = await this.runner.run(state.action.address, inputs, state.source);
    const errors = started.errors ?? {};
    const done = started.failed === undefined && Object.keys(errors).length === 0;
    this.current.set(
      done
        ? undefined
        : {
            ...state,
            errors,
            sending: false,
            // Сервер отказал — назад к форме с ошибками, а не снова к вопросу.
            asking: undefined,
            ...(started.failed === undefined ? {} : { failed: started.failed }),
          },
    );
  }

  private listen(): void {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.cancel();
    };
    document.addEventListener("keydown", escape);
    this.listening = () => document.removeEventListener("keydown", escape);
  }

  private unlisten(): void {
    this.listening?.();
    this.listening = undefined;
  }
}
