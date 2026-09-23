import { createContext, useContext, type ReactNode } from "react";
import type { MapFile } from "@mapward/core";

/**
 * Что директивам нужно от экрана — решение 0042: что умеет хост, открыть файл директивы и
 * попросить агента запустить этап. Терминалы и хост держит точка входа.
 */
export type DirectivesPort = {
  /** Спросить «точно?» и имя новой умеет только хост (решение 0014). */
  ask: boolean;
  open?: ((file: MapFile) => void) | undefined;
  /** Кнопка этапа: фраза уходит в живую сессию объекта (решение 0017). */
  runStage?: ((file: MapFile, stage: string) => void) | undefined;
};

const DirectivesContext = createContext<DirectivesPort | undefined>(undefined);

export function ProvideDirectives(props: { port: DirectivesPort; children: ReactNode }) {
  return <DirectivesContext value={props.port}>{props.children}</DirectivesContext>;
}

export function useDirectivesPort(): DirectivesPort {
  const port = useContext(DirectivesContext);
  if (!port) throw new Error("ProvideDirectives is missing above this component");
  return port;
}
