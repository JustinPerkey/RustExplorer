# AGENTS.md

Working notes for coding agents (and humans in a hurry) on **Rust Explorer**, a VS Code
extension that renders a workspace the way Rust resolves modules: `parser.rs` expands
into the submodules living in `parser/`.

Read `README.md` first for what the extension does and what every setting means. This
file covers how to change it without breaking the parts that are easy to get wrong.

## Quick start

```sh
npm ci              # the repo is checked in without node_modules
npm run compile     # tsc -p ./  (or: npm run watch)
npm test            # compiles, then runs the unit tests under out/test
npm run lint        # eslint src --ext .ts
npm run package     # builds the .vsix with vsce
```

CI runs `lint`, `compile` and `test` on Node 20 and 22, then packages the `.vsix`.
Run all three locally before pushing; the extension host is not exercised by CI, so a
change to `src/tree/` or `src/commands.ts` also wants a manual pass (below).

## Layout

| Path | What lives there |
| --- | --- |
| `src/model/` | Pure logic, no `vscode` import. This is what the unit tests exercise. |
| `src/tree/` | The `TreeDataProvider`, row presentation and problem decorations. |
| `src/commands.ts` | Create / rename / delete / declare, as `WorkspaceEdit`s. |
| `src/config.ts` | Reads `rustExplorer.*` settings into one `RustExplorerConfig`. |
| `src/extension.ts` | Activation: view, watchers, debounced refresh. |
| `src/test/` | `node:test` suites, one per model file. |
| `fixtures/sample-crate/` | A crate with both module layouts plus an undeclared file. |

**Keep `src/model/` free of `vscode`.** It is the only layer that can be unit tested, so
new decisions ("which file owns this row", "where does this module's file belong") go
there as pure functions and the VS Code layers call them. `src/tree/` and
`src/commands.ts` should read as glue.

## The Rust rules the code encodes

Most bugs in this repo are a misreading of module resolution rather than a TypeScript
mistake. The three cases that matter:

- **`parser.rs` owns `parser/`.** `mod ast;` inside `src/parser.rs` is
  `src/parser/ast.rs`. The directory is absorbed into the file's row.
- **`parser/mod.rs` is the same module** in the 2015 layout: one row for the directory,
  which opens `mod.rs`, and `mod ast;` there means `src/parser/ast.rs`.
- **A crate root declares its siblings.** `mod parser;` in `src/lib.rs` (or
  `src/main.rs`) is `src/parser.rs` — *not* `src/lib/parser.rs`. A `src/lib/` directory
  that happens to exist is an ordinary folder and must not swallow `lib.rs`.

`submoduleDirectoryOf()` in `src/model/moduleTree.ts` is the single answer to "where do
this file's modules live"; `RustModuleTreeProvider.moduleContentDirectory()` wraps it
with the crate detection. Use them instead of appending the module name to a path.

Two related sets, deliberately different: `CRATE_ROOT_MODULES` (`lib`, `main`) are the
roots whose modules are siblings, and `IMPLICIT_ROOTS` adds `build` — files that are
compiled without a `mod` statement and so are never marked `not declared`.

## Adding a setting

Three places, all required, or the setting silently reads its default:

1. `package.json` → `contributes.configuration.properties` (with a `markdownDescription`).
2. `src/config.ts` → the `RustExplorerConfig` field and its `config.get(...)` call.
3. `README.md` → the settings table.

Settings that change the shape of the tree belong to `BuildOptions` in
`src/model/moduleTree.ts`; settings that only change how a row is drawn stay in
`RustExplorerConfig` and are read by the provider. Anything read at render time is
picked up on the next `provider.refresh()`, which the configuration listener in
`src/extension.ts` already fires.

## Tests

`node:test` with `describe`/`it` and `node:assert/strict`; no test framework to learn.
Files are `src/test/<model>.test.ts` and run compiled out of `out/test` by
`scripts/run-tests.js` (Node 20 and 22 disagree about globs — that is why the script
exists; hand test paths to it, not to `node --test`).

Every change to `src/model/` needs a test. Prefer the existing helpers in
`moduleTree.test.ts`: `entries('parser.rs', 'parser/')` builds a listing, `module(nodes,
'parser')` pulls one row out. Test names read as sentences about behaviour, not about
functions.

## Manual verification

Press <kbd>F5</kbd> and pick **Run Extension (sample crate)**: the host opens
`fixtures/sample-crate`, which covers `parser.rs` + `parser/`, `legacy/mod.rs`, a crate
root, and `scratch.rs` with no `mod` declaration. Editing commands are worth a real run —
they are `WorkspaceEdit`s, so file, directory and `mod` statement have to land in one
undoable step (<kbd>Ctrl</kbd>+<kbd>Z</kbd> should put everything back).

## Style

- TypeScript strict, `noUnusedLocals`, `noUnusedParameters`; two-space indent, single
  quotes, semicolons. `eqeqeq` is an error, `curly` a warning.
- Explicit return types on exported functions; `readonly` on model interfaces.
- Comments explain *why*, usually a Rust rule the code has to respect. Do not narrate
  what the next line does.
- Prefer `undefined` over `null`, and early returns over nesting.

## Docs and releases

Update `README.md` in the same commit as the change when behaviour, a command or a
setting changes — the README is the marketplace page, so a release that ships behaviour
the README does not describe is a release with a stale listing.

### Cutting a release

Two steps, in this order — the workflow can do the whole thing on its own, but then the
release notes are raw commit subjects, which is not what ships.

1. **A release PR.** On a branch: `npm version <x.y.z> --no-git-tag-version` (never `npm
   version` on its own — no tag, no commit), then write the `## <x.y.z>` section of
   `CHANGELOG.md` by hand, in the voice of the sections above it: what changed for
   someone using the extension, not what the commits did. Pre-1.0, anything user-facing
   and new is a minor bump; fixes alone are a patch. Merge it to `main`.
2. **Actions → Release**, run from `main`, with **version** set to the exact version the
   PR landed (leave **bump** alone; it is ignored when **version** is set). The workflow
   re-runs lint, compile and test, sees `package.json` is already there, reuses the
   `CHANGELOG.md` section verbatim as the release notes, then commits, tags `v<x.y.z>`,
   pushes and publishes the GitHub release with the `.vsix` attached. `dry_run` does
   everything except push and publish.

`scripts/changelog.js` only writes a section when the version is undocumented, and it
builds it from commit subjects since the last tag, skipping merges. That fallback is
what step 1 exists to avoid — but it is also why commit subjects should read as
changelog lines ("Create new modules beside a crate root, not inside `src/lib/`").

The tag has to be new: re-running the workflow for a version that already shipped fails
on `Tag v<x.y.z> already exists`, deliberately.
