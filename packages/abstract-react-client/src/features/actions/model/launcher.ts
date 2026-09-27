import { action, makeObservable, reaction, observableRef } from "mobx";
import { confirmQuestion } from "@mapward/core";
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

/** Чем запускать: ответ приходит сразу, до конца прогона (решение 0038). */
export type LaunchRunner = {
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
  given: Record<string, unknown>;
  source: RunSource;
  values: FormValues;
  errors: Record<string, string>;
  failed?: string;
  sending: boolean;
  asking?: Asking | undefined;
};

/**
 * Запуск экшона — один путь для шапки, клетки раскладки, строки дисплея и компонента
 * (решение 0038): всё обязательное заполнено и `confirm` не просили — сразу, иначе форма с
 * переданными значениями. `confirm` текстом — вопрос отдельным окном перед самым запуском,
 * после формы, если она была. Сервер нашёл ошибки в полях — форма открывается с ними, даже если
 * запускали без неё. Escape закрывает форму и вопрос, как клик мимо них.
 */
export class Launcher {
  opened: Open | undefined = undefined;
  private stop: (() => void) | undefined;
  private listening: (() => void) | undefined;

  constructor(private readonly runner: LaunchRunner) {
    makeObservable(this, {
      opened: observableRef,
      launch: action,
      change: action,
      submit: action,
      confirm: action,
      cancel: action,
    });
  }

  launch(target: MapAction, given: Record<string, unknown> = {}, source: RunSource = "ui"): void {
    const state: Open = {
      action: target,
      given,
      source,
      values: startValues(target.config.inputs, given),
      errors: {},
      sending: false,
    };
    if (needsForm(target, given)) this.opened = state;
    // Без формы — переданное как есть: умолчания подставит сервер, он же их и проверит.
    else this.ask(state, given);
  }

  change(name: string, value: FormValue): void {
    if (!this.opened) return;
    this.opened = { ...this.opened, values: { ...this.opened.values, [name]: value } };
  }

  submit(): void {
    const open = this.opened;
    if (!open) return;
    this.ask(open, formPayload(open.action.config.inputs, open.values, open.given));
  }

  /** «Да» на вопрос перед запуском: уходит то, о чём спрашивали. */
  confirm(): void {
    const open = this.opened;
    if (!open?.asking) return;
    const sending = { ...open, sending: true };
    this.opened = sending;
    void this.send(sending, open.asking.payload);
  }

  cancel(): void {
    this.opened = undefined;
  }

  /** Есть вопрос — сначала он, с подставленными данными формы; нет — запуск сразу. */
  private ask(state: Open, payload: Record<string, unknown>): void {
    const question = confirmQuestion(state.action.config, payload);
    if (question !== undefined) {
      this.opened = { ...state, errors: {}, asking: { question, payload } };
      return;
    }
    const sending = { ...state, sending: true };
    // Из формы — она ждёт ответа сервера; без формы на экране ничего не открывалось.
    if (this.opened === state) this.opened = sending;
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

  get inputs(): Record<string, ActionInput> {
    return this.opened?.action.config.inputs ?? {};
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
      ...strayErrors(open.action.config.inputs, open.errors),
    ];
  }

  mount(): void {
    this.stop = reaction(
      () => this.opened !== undefined,
      (open) => (open ? this.listen() : this.unlisten()),
    );
  }

  unmount(): void {
    this.stop?.();
    this.unlisten();
  }

  private async send(state: Open, inputs: Record<string, unknown>): Promise<void> {
    const started = await this.runner.run(state.action.address, inputs, state.source);
    const errors = started.errors ?? {};
    const done = started.failed === undefined && Object.keys(errors).length === 0;
    this.settle(
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

  private readonly settle = action((next: Open | undefined) => {
    this.opened = next;
  });

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
