/**
 * Server: the only place where the map meets processes.
 *
 * Watches files, serves the model to the UI, keeps agent conversations (one live session per node)
 * and runs code actions. The standalone app and the VSCode extension talk to it the same way, so the
 * logic does not drift apart between two clients.
 */
export const VERSION = "0.0.0";
