# Changelog

## 0.1.0

Initial release.

- **Rust Modules** view in the Explorer sidebar, nesting `name.rs` with the contents of
  `name/` and representing `name/mod.rs` as a single module row.
- Crate roots (`src/lib.rs`, `src/main.rs`) own the modules they declare.
- `.rs` files that no `mod` statement declares are marked `not declared`.
- Create, rename and delete modules with their `mod` declaration, file and directory
  kept in sync; add a missing `mod` declaration from the context menu.
- Settings for nesting, labels, sorting, exclusions and `mod` visibility.
