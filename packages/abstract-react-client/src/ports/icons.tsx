import { createContext, type ReactNode, useContext } from "react";

/**
 * Иконки — порт хоста, как и тема: решение 0014. В редакторе их даёт шрифт codicon, в браузере
 * даст что-то своё, а клиент знает только имя иконки и просит нарисовать.
 */
export type RenderIcon = (name: string, className?: string) => ReactNode;

/** Без хоста иконок нет, но интерфейс не ломается: место под иконку просто остаётся пустым. */
const fallback: RenderIcon = (_name, className) => <span className={className} />;

const IconsContext = createContext<RenderIcon>(fallback);

export function ProviderIcons(props: { render?: RenderIcon; children: ReactNode }) {
  return <IconsContext value={props.render ?? fallback}>{props.children}</IconsContext>;
}

export function useIcon(): RenderIcon {
  return useContext(IconsContext);
}
