import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import { observer } from "mobx-react-lite";
import type { DisplayBuild } from "@mapward/core";
import type { DisplayProps } from "@mapward/display";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { ComponentModule } from "../model/component-module.ts";
import { ProvideKit, type KitLinks } from "../ports.tsx";
import { loadModule } from "../ui/component-module.ts";
import {
  ComponentBoundary,
  ComponentBuilding,
  ComponentFailure,
  ComponentStyle,
} from "../ui/component-parts.tsx";
import { DisplayKit } from "./display-kit.tsx";

/** Что модуль компонента получает на `require`: одна копия React на странице (решение 0037). */
const Provided: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": JsxRuntime,
  "react/jsx-dev-runtime": JsxRuntime,
  "@mapward/display": DisplayKit,
};

/**
 * Дисплей-компонент метрики — решение 0037. Код и css приносит сервер; здесь модуль
 * выполняется, css ложится своим `<style>` и уходит вместе с ячейкой.
 */
export const ComponentDisplay = observer(function ComponentDisplay(props: {
  build: DisplayBuild | undefined;
  /** Что не прошло схему: компонент тогда не рисуется — ему пришло не то, что он объявил. */
  invalid?: string[] | undefined;
  display: DisplayProps;
  links: KitLinks;
}) {
  const module = useLocalStore(
    () => new ComponentModule(props.build, props.invalid, (code) => loadModule(code, Provided)),
    [props.build, props.invalid],
  );
  const View = module.view;

  return module.building ? (
    <ComponentBuilding />
  ) : module.failure ? (
    <ComponentFailure title={module.failure.title} lines={module.failure.lines} />
  ) : View ? (
    <ProvideKit links={props.links}>
      <ComponentStyle css={module.css} />
      <ComponentBoundary
        build={module.builtAt}
        fallback={(message) => (
          <ComponentFailure title="компонент упал при отрисовке" lines={[message]} />
        )}
      >
        <View {...props.display} />
      </ComponentBoundary>
    </ProvideKit>
  ) : null;
});
