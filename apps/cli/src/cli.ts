#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import type { Environment } from "@mapward/core";
import { VERSION } from "@mapward/core";

/** The Node binding of the environment: the one place in this app that is allowed to know about `fs`. */
const nodeEnvironment: Environment = {
  async readDirectory(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  },
  readTextFile(path) {
    return readFile(path, "utf8");
  },
};

async function main(): Promise<void> {
  const [command, target = "map"] = argv.slice(2);

  if (command !== "check") {
    console.error("usage: mapward check [path-to-map]");
    exit(1);
  }

  // Validation itself arrives with the spec; what this proves today is that an app can hand the core
  // an environment and the core needs nothing else.
  const entries = await nodeEnvironment.readDirectory(target);
  console.log(`mapward core ${VERSION}: read ${entries.length} entries in ${target}`);
}

await main();
