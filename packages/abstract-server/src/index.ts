/**
 * The server side of the map: use cases and the domain.
 *
 * It reads maps, collects metrics, runs directives — and asks the environment for all of it through
 * ports. Files, watchers, shell processes and the agent are given to it by an app; it never reaches
 * for them itself. That is what lets the same server run inside the editor and from a terminal.
 *
 * Decision `ru/docs/decisions/0013-client-server.md`.
 */
export const VERSION = "0.0.0";
