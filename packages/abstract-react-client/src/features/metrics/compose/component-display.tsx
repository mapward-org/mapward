import * as React from "react";
import * as ReactDom from "react-dom";
import * as JsxRuntime from "react/jsx-runtime";
import * as Rxjs from "rxjs";
import * as RxjsOperators from "rxjs/operators";
import type { ComponentBuild } from "@mapward/core";
import { useLocalStore } from "../../../lib/store/use-local-store.ts";
import { ComponentModule } from "../model/component-module.ts";
import { ProvideKit, type KitLinks } from "../ports.tsx";
import { loadModule } from "../ui/component-module.ts";
import {
  ComponentBoundary,
  ComponentBuilding,
  ComponentFailure,
  ComponentScope,
  ComponentStyle,
} from "../ui/component-parts.tsx";
import { ComponentKit } from "./component-kit.tsx";

/**
 * Что модуль компонента получает на `require`: одна копия React на странице (решение 0037) и
 * одна rxjs — та, на которой стоят потоки плагинов: `pipe` и `instanceof` сходятся.
 */
const Provided: Record<string, unknown> = {
  react: React,
  // Порталы библиотек компонента — той же копией, что у карты: второй рендерер ломает дерево.
  "react-dom": ReactDom,
  "react/jsx-runtime": JsxRuntime,
  "react/jsx-dev-runtime": JsxRuntime,
  "@mapward/component": ComponentKit,
  rxjs: Rxjs,
  "rxjs/operators": RxjsOperators,
};

/**
 * Компонент метрики — решение 0037. Код и css приносит сервер; здесь модуль выполняется, css
 * ложится своим `<style>` и уходит вместе с ячейкой.
 */
export function ComponentDisplay(props: {
  build: ComponentBuild | undefined;
  /** Пропсы модуля: у метрики — `MetricProps`, у раскладки — `LayoutProps`, у формы — свои. */
  display: object;
  links: KitLinks;
}) {
  // Модуль — по коду и css, а не по сборке: пересборка тем же кодом (тронули файл, сверка входов
  // не сошлась) не перемонтирует компонент и не сбрасывает его состояние.
  const module = useLocalStore(
    () => new ComponentModule(props.build, (code) => loadModule(code, Provided)),
    [props.build === undefined, props.build?.code, props.build?.css, props.build?.errors?.join()],
  );
  const View = module.view;

  return module.building ? (
    <ComponentBuilding />
  ) : module.failure ? (
    <ComponentFailure title={module.failure.title} lines={module.failure.lines} />
  ) : View ? (
    <ProvideKit links={props.links} territory={module}>
      <ComponentStyle css={module.css} />
      <ComponentScope scope={module.scope}>
        <ComponentBoundary
          build={module.builtAt}
          fallback={(message) => (
            <ComponentFailure title="компонент упал при отрисовке" lines={[message]} />
          )}
        >
          <View {...props.display} />
        </ComponentBoundary>
      </ComponentScope>
    </ProvideKit>
  ) : null;
}
