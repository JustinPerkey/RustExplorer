# Rust Explorer

[![CI](https://github.com/JustinPerkey/RustExplorer/actions/workflows/ci.yml/badge.svg)](https://github.com/JustinPerkey/RustExplorer/actions/workflows/ci.yml)

A VS Code extension that shows your files the way Rust sees them: `parser.rs` expands
into the submodules that live in `parser/`.

VS Code's built-in file nesting (`explorer.fileNesting.patterns`) can only nest files
that sit in the *same* directory, so it cannot express the Rust module layout at all.
Rust Explorer contributes its own **Rust Modules** view to the Explorer sidebar instead.

```
src/                                  src/
├── legacy/                           └── lib.rs
│   ├── compat.rs                         ├── legacy            mod.rs
│   └── mod.rs             ───▶            │   └── compat
├── parser/                                ├── parser
│   ├── ast.rs                             │   ├── ast
│   └── lexer.rs                           │   └── lexer
├── util/                                  ├── util
│   └── text.rs                            │   └── text
├── lib.rs                                 └── scratch          not declared
├── parser.rs
├── scratch.rs
└── util.rs
```

## What it does

- **`name.rs` expands into `name/`.** The directory disappears as a separate row; its
  contents become the children of the file that owns them (2018 edition layout).
- **`name/mod.rs` works too.** A directory with a `mod.rs` is shown as one module row
  that opens `mod.rs` when clicked; the `mod.rs` file itself is hidden by default.
- **Crate roots own their modules.** In a crate's `src/`, `lib.rs` (or `main.rs`)
  becomes the parent of the modules it declares, mirroring `crate::`.
- **Undeclared files are called out.** A `.rs` file that no `mod` statement declares is
  marked `not declared`, because Rust never compiles it.
- **Module-aware editing.** Create, rename and delete modules and the `mod` declaration,
  the file and the module directory are kept in sync in a single undoable step.

## Commands

| Command | What it does |
| --- | --- |
| `Rust Explorer: New Module...` | Creates `<name>.rs` under the selected module (creating its directory if needed) and adds `mod <name>;` to the owning file. |
| `Rust Explorer: Rename...` | Renames the module file, its directory and its `mod` declaration together. |
| `Rust Explorer: Delete` | Deletes the module file and its directory, and removes the `mod` declaration. |
| `Rust Explorer: Add mod Declaration` | Declares an undeclared `.rs` file in its owning module. |
| `Rust Explorer: Reveal Active File` | Selects the active editor's file in the view. |
| `Rust Explorer: Refresh` | Rebuilds the tree. |

`Open to the Side`, `Reveal in Explorer View`, `Copy Path` and `Copy Relative Path` are
available from the context menu.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `rustExplorer.nestCrateRoot` | `true` | Nest a crate's top-level modules under `lib.rs`/`main.rs`. |
| `rustExplorer.hideModRs` | `true` | Hide `mod.rs` inside its own module directory. |
| `rustExplorer.labelStyle` | `module` | Label rows with the module name (`parser`) or the file name (`parser.rs`). |
| `rustExplorer.showNonRustFiles` | `true` | Show `Cargo.toml`, `README.md` and friends alongside modules. |
| `rustExplorer.markUndeclaredModules` | `true` | Mark `.rs` files no `mod` statement declares. |
| `rustExplorer.sortOrder` | `type` | `type`, `alphabetical`, or `declaration` (the order the `mod` statements appear in). |
| `rustExplorer.moduleVisibility` | `private` | Visibility of `mod` declarations written by **New Module**. |
| `rustExplorer.followActiveEditor` | `true` | Reveal the active editor's file in the view. |
| `rustExplorer.exclude` | `**/target`, `**/.git`, `**/node_modules` | Glob patterns to hide. |

## Development

```sh
npm install
npm run compile     # or: npm run watch
npm test            # unit tests for the nesting and `mod` parsing logic
npm run lint
```

Press <kbd>F5</kbd> to launch an Extension Development Host. The
**Run Extension (sample crate)** launch configuration opens `fixtures/sample-crate`,
which contains both module layouts plus an undeclared file.

Packaging a `.vsix` uses `@vscode/vsce`, which is installed as a dev dependency:

```sh
npm run package
```

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request against `main` and on every push
to `main` (including merges). It lints, compiles and runs the unit tests on Node 20 and
22, then builds the `.vsix` and uploads it as a build artifact named
`rust-explorer-<version>-vsix`, downloadable from the workflow run summary.

## How the tree is built

`src/model/` holds the logic and knows nothing about VS Code, which is what the unit
tests exercise:

- `moduleTree.ts` turns one directory listing into rows: which directory is absorbed by
  which file, what is a crate root, how rows are sorted.
- `modDeclarations.ts` scans Rust source for `mod` declarations (skipping comments,
  strings, raw strings and inline `mod x { .. }` blocks) and works out where to insert
  or remove one.
- `glob.ts` is a small matcher for the `exclude` patterns.

`src/tree/` maps that model onto the VS Code tree API, and `src/commands.ts` implements
the file operations.

## Limitations

- `#[path = "..."]` attributes are not followed; nesting is based on the file layout.
- The built-in Explorer is unchanged — VS Code does not allow extensions to alter it.
  Rust Explorer adds its own view, which you can drag anywhere in the sidebar.
- Drag and drop between modules is not implemented yet.
