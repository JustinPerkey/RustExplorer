# Changelog

## 0.2.0

- **Errors and warnings roll up onto module rows.** A module row now carries the problems
  of everything underneath it, coloured after the worst of them and badged with the count,
  so a collapsed `parser.rs` shows that something under `parser/` is broken. Turn it off
  with `rustExplorer.rollUpProblems`.
- `src/lib.rs` and `src/main.rs` keep a row of their own next to a directory of the same
  name. `src/lib/` used to absorb `src/lib.rs`, which left the crate root marked
  `not declared` and stopped the crate's top-level modules from nesting under it.

## 0.1.0

Initial release.

- **Rust Modules** view in the Explorer sidebar, nesting `name.rs` with the contents of
  `name/` and representing `name/mod.rs` as a single module row.
- Crate roots (`src/lib.rs`, `src/main.rs`) own the modules they declare.
- `.rs` files that no `mod` statement declares are marked `not declared`.
- Create, rename and delete modules with their `mod` declaration, file and directory
  kept in sync; add a missing `mod` declaration from the context menu.
- Settings for nesting, labels, sorting, exclusions and `mod` visibility.
