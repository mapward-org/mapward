import { Component, type ComponentType, type ReactNode, useMemo } from "react";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import type { DisplayBuild } from "@mapward/core";
import type { DisplayProps } from "@mapward/display";
import { evaluateModule } from "../pure-model/evaluate.ts";
import { displayKit, KitProvider, type KitLinks } from "./display-kit.tsx";

/** Что модуль компонента получает на `require`: одна копия React на странице (решение 0037). */
const PROVIDED: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": JsxRuntime,
  "react/jsx-dev-runtime": JsxRuntime,
  "@mapward/display": displayKit,
};

function Failure(props: { title: string; lines: string[] }) {
  return (
    <div className="text-[var(--mw-errorForeground)]">
      <div>{props.title}</div>
      {props.lines.map((line) => (
        <pre key={line} className="m-0 whitespace-pre-wrap text-[11px] opacity-80">
          {line}
        </pre>
      ))}
    </div>
  );
}

/**
 * Упавший компонент — красная строка в ячейке, а не пустой сайдбар. Новая сборка сбрасывает
 * ошибку: её для того и пересобирали.
 */
class Boundary extends Component<
  { build: string; children: ReactNode },
  { error?: Error; build?: string }
> {
  override state: { error?: Error; build?: string } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { build: string },
    state: { error?: Error; build?: string },
  ) {
    return props.build === state.build ? null : { error: undefined, build: props.build };
  }

  override render() {
    return this.state.error ? (
      <Failure title="компонент упал при отрисовке" lines={[this.state.error.message]} />
    ) : (
      this.props.children
    );
  }
}

/**
 * Дисплей-компонент метрики — решение 0037. Код и css приносит сервер; здесь модуль
 * выполняется, css ложится своим `<style>` и уходит вместе с ячейкой.
 */
export function ComponentDisplay(props: {
  build: DisplayBuild | undefined;
  /** Что не прошло схему: компонент тогда не рисуется — ему пришло не то, что он объявил. */
  invalid?: string[];
  display: DisplayProps;
  links: KitLinks;
}) {
  const code = props.build?.code;
  const loaded = useMemo((): { view?: ComponentType<DisplayProps>; error?: string } => {
    if (code === undefined) return {};
    try {
      const view = evaluateModule(code, PROVIDED);
      return typeof view === "function"
        ? { view: view as ComponentType<DisplayProps> }
        : { error: "модуль не экспортирует компонент по умолчанию" };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [code]);

  if (!props.build) return <span className="opacity-60">собирается…</span>;
  if (props.invalid && props.invalid.length > 0) {
    return <Failure title="данные не прошли схему" lines={props.invalid} />;
  }
  if (props.build.errors && props.build.errors.length > 0) {
    return <Failure title="компонент не собрался" lines={props.build.errors} />;
  }
  if (loaded.error || !loaded.view) {
    return <Failure title="компонент не загрузился" lines={[loaded.error ?? "нет кода"]} />;
  }

  const View = loaded.view;
  return (
    <KitProvider value={props.links}>
      {props.build.css && <style>{props.build.css}</style>}
      <Boundary build={props.build.builtAt}>
        <View {...props.display} />
      </Boundary>
    </KitProvider>
  );
}
