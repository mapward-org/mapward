import { createContext, useContext, type ReactNode } from "react";
import type { Host } from "./adapters/host.ts";

const HostContext = createContext<Host | undefined>(undefined);

/** Хост один на клиент: его заводит точка входа и раздаёт всем. */
export function ProvideHost(props: { host: Host; children: ReactNode }) {
  return <HostContext value={props.host}>{props.children}</HostContext>;
}

export function useHost(): Host {
  const host = useContext(HostContext);
  if (!host) throw new Error("ProvideHost is missing above this component");
  return host;
}
