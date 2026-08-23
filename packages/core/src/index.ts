/**
 * Core: the map model. Reads folders, validates them, exposes the structure.
 *
 * Nothing about VSCode, the UI or running agents belongs here: the core is used by the server,
 * by the extension and by the CLI check alike. The implementation follows the spec — for now only
 * the package boundary is fixed.
 */
export const VERSION = "0.0.0";
