import { Component, type ReactNode } from "react";

export function ComponentBuilding() {
  return <span className="opacity-60">собирается…</span>;
}

export function ComponentFailure(props: { title: string; lines: string[] }) {
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

/** Css компонента ложится своим `<style>` и уходит вместе с ячейкой. */
export function ComponentStyle(props: { css: string | undefined }) {
  return props.css ? <style>{props.css}</style> : null;
}

type BoundaryState = { error?: Error; build?: string };

/**
 * Упавший компонент — красная строка в ячейке, а не пустой сайдбар. Новая сборка сбрасывает
 * ошибку: её для того и пересобирали. Что показать вместо упавшего, говорит `compose`.
 */
export class ComponentBoundary extends Component<
  { build: string; fallback: (message: string) => ReactNode; children: ReactNode },
  BoundaryState
> {
  override state: BoundaryState = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { build: string }, state: BoundaryState) {
    return props.build === state.build ? null : { error: undefined, build: props.build };
  }

  override render() {
    return this.state.error ? this.props.fallback(this.state.error.message) : this.props.children;
  }
}
