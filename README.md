# Archmap

An architecture map: the model lives in folders, you work with it as a diagram, and every node has an
ongoing conversation with an agent next to it.

This is version 2. Version 1 was a prototype inside `leafer/archmap`; it stays there as a record of
what was tried and is not ported here — v2 is built from a spec, not by rewriting the prototype.

Russian version of this document: [`ru/README.md`](ru/README.md).

## Decided so far

- **A tool of its own, not part of leafer.** The map is generic: any system, any hierarchy.
- **Not VSCode-only.** One UI, two clients: standalone and the extension's webview.
- **A conversation, not a launch.** Each node keeps a long-lived agent session; an action is a message
  into it, not a fresh process that re-gathers context. In the prototype every click cost a minute
  on exactly that.
- **Internals are marked with `_`.** Docs are just docs, children are just subfolders.
- **English by default.** The root holds the English version; `ru/` holds the Russian one.

## Monorepo

```
packages/               published to npm; knows nothing about where it runs
  core/                 the map model: reading folders, validation, tracing
  server/               watching, agent conversations, running code actions
  ui/                   diagram and panels: a single codebase
apps/                   bindings: one per environment the packages run in
  cli/                  terminal and CI
  vscode-extension/     the editor: webview plus what a browser cannot do
map/                    Archmap's own map — it describes itself
ru/                     Russian space: its own README and `ru/map`
```

The split is the point: a package takes its environment as an argument (`Environment` in `core`),
an app is the only place that knows about `node:fs`, the `vscode` API or a desktop shell. Node types
are declared by the apps alone, so a package cannot even type-check a platform import — and
`tests/platform-independence.test.ts` fails if one appears anyway.

## Toolchain

Decided in `ru/map/decisions/0001-monorepo.md`; this is what it means in practice.

| Concern | Tool |
| --- | --- |
| Package manager | pnpm workspaces, one tool version per repo via the `catalog:` |
| Task runner | Turborepo — `build`, `typecheck`, `dev`, with caching |
| Language | TypeScript 7 |
| Bundler | tsdown (rolldown) per package; the extension is emitted as CJS, everything else ESM |
| Tests | Vitest, a single run for the whole repo |
| Lint and format | oxlint and oxfmt, default rules only |
| Releases | Changesets — versions, changelogs and tags on GitHub |

```sh
pnpm install
pnpm build        # tsdown per package, in dependency order
pnpm typecheck    # tsc, no emit
pnpm test         # vitest
pnpm lint         # oxlint
pnpm format       # oxfmt (leaves the maps alone: they are content, not code)
pnpm changeset    # describe a change before merging it
```

## Languages

A map is text, and text is written in one language but read in many. So maps live in language spaces,
and the default one — English — sits at the root.

- English is what a visitor sees: `README.md` and `map/`.
- Russian lives in `ru/README.md` and `ru/map/`.
- The structure inside every space is identical: translation changes the text, not the shape of the map.
- Code, interface names and commit messages are English — they are the same for every language.

Translation between spaces is done by AI, not by hand.

## Map structure

An object is a folder. Internals start with `_`, everything else is content:

```
map/
  leafer/
    _index.md          the object itself: its class and fields
    Purpose.md         a doc — just a file next to it
    Scenarios.md
    catalog/           a child — an ordinary subfolder
    _actions/          the node's actions
    _sessions/         conversations: the history of working on this node
```

No `state/`, no `state/children/`: children are unprefixed subfolders, docs are files. That is the
main departure from the prototype, where the service layers added more noise than the model itself.

## Dogfooding

`map/` is this project's own map. The point is not the example: if the tool is awkward for describing
itself, it is no good for describing anyone else's system.
