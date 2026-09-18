/**
 * The client side of the map: React and tailwind, one codebase for every host.
 *
 * It talks to the server through the contract in `core` and never imports the server itself. Opening
 * a file, starting a conversation, remembering view state and the theme come from the host through
 * ports — abstract enough to render in the editor today and in a browser or a desktop shell later.
 *
 * Decision `ru/docs/decisions/0013-client-server.md`.
 */
export const VERSION = "0.0.0";
