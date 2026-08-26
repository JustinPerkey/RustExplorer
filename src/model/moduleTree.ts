/**
 * Turns a plain directory listing into the nested shape Rust programmers think
 * in: `parser.rs` owns everything inside `parser/`, and a crate root owns the
 * modules it declares.
 *
 * This module is deliberately free of VS Code and file system APIs: the caller
 * supplies the listing, the answer is a description of what to render.
 */

import { isValidModuleName } from './modDeclarations';

export type EntryType = 'file' | 'directory';

export interface DirEntry {
  readonly name: string;
  readonly type: EntryType;
}

/** `parser.rs` + `parser/` (2018 edition) or `parser/mod.rs` (2015 edition). */
export type ModuleStyle = 'file' | 'mod-rs';

export interface ModuleModel {
  readonly kind: 'module';
  /** The Rust module name, e.g. `parser`. */
  readonly name: string;
  /** Entry name of the backing file, relative to the listed directory. */
  readonly file: string;
  /** Entry name of the directory holding the submodules, when there is one. */
  readonly directory?: string;
  readonly style: ModuleStyle;
  /** `true`/`false` when the owning file is known, `undefined` when it is not. */
  readonly declared?: boolean;
  /** Crate roots (`lib.rs`, `main.rs`) and build scripts are never `mod`-declared. */
  readonly isCrateRoot: boolean;
  /** Sibling entries pulled underneath this node by crate root nesting. */
  readonly nested: readonly NodeModel[];
}

export interface DirectoryModel {
  readonly kind: 'directory';
  readonly name: string;
}

export interface FileModel {
  readonly kind: 'file';
  readonly name: string;
}

export type NodeModel = ModuleModel | DirectoryModel | FileModel;

export type SortOrder = 'type' | 'alphabetical' | 'declaration';

export interface BuildOptions {
  readonly nestCrateRoot: boolean;
  readonly hideModRs: boolean;
  readonly showNonRustFiles: boolean;
  readonly sortOrder: SortOrder;
}

export const DEFAULT_BUILD_OPTIONS: BuildOptions = {
  nestCrateRoot: true,
  hideModRs: true,
  showNonRustFiles: true,
  sortOrder: 'type'
};

export interface BuildInput {
  readonly entries: readonly DirEntry[];
  /** Sub-directory names known to contain a `mod.rs`. */
  readonly dirsWithModRs?: ReadonlySet<string>;
  /** Modules declared by the file that owns this directory, in source order. */
  readonly declaredModules?: readonly string[];
  /** The listed directory is the `src` of a crate, so `lib.rs`/`main.rs` are crate roots. */
  readonly isCrateRoot?: boolean;
  /** The listed directory belongs to a module, so its `mod.rs` is already represented. */
  readonly isModuleDirectory?: boolean;
}

/**
 * Crate roots, whose `mod` declarations resolve to files sitting *beside* them:
 * `mod parser;` in `src/lib.rs` is `src/parser.rs`, never `src/lib/parser.rs`.
 */
export const CRATE_ROOT_MODULES: ReadonlySet<string> = new Set(['lib', 'main']);

/** Files that are compiled without ever being declared by a `mod` statement. */
export const IMPLICIT_ROOTS: ReadonlySet<string> = new Set([...CRATE_ROOT_MODULES, 'build']);

export function moduleNameOf(fileName: string): string | undefined {
  if (!fileName.endsWith('.rs')) {
    return undefined;
  }
  const stem = fileName.slice(0, -'.rs'.length);
  return isValidModuleName(stem) ? stem : undefined;
}

/**
 * The directory the `mod` declarations written in `fileName` resolve against,
 * named relative to the directory `fileName` itself sits in: `parser.rs` owns
 * `parser/`. `undefined` means that same directory, which is where a `mod.rs`
 * and a crate root (`src/lib.rs`, `src/main.rs`) declare their modules.
 */
export function submoduleDirectoryOf(fileName: string, isCrateSourceDir = false): string | undefined {
  if (fileName === 'mod.rs') {
    return undefined;
  }
  const name = moduleNameOf(fileName);
  if (name === undefined || (isCrateSourceDir && CRATE_ROOT_MODULES.has(name))) {
    return undefined;
  }
  return name;
}

export function buildDirectoryModel(input: BuildInput, options: BuildOptions): NodeModel[] {
  const files = new Set<string>();
  const directories: string[] = [];

  for (const entry of input.entries) {
    if (entry.type === 'directory') {
      directories.push(entry.name);
    } else {
      files.add(entry.name);
    }
  }

  const dirsWithModRs = input.dirsWithModRs ?? new Set<string>();
  const declared = input.declaredModules;
  const claimedFiles = new Set<string>();
  const nodes: NodeModel[] = [];

  const declarationOf = (name: string, isCrateRoot: boolean): boolean | undefined => {
    if (isCrateRoot || declared === undefined) {
      return undefined;
    }
    return declared.includes(name);
  };

  // A crate root owns no directory of its own: the modules `src/lib.rs` declares
  // live in `src/`, not in `src/lib/`. A directory of that name is therefore an
  // ordinary directory, and must not swallow the crate root sitting next to it.
  const isImplicitRoot = (name: string): boolean =>
    Boolean(input.isCrateRoot) && IMPLICIT_ROOTS.has(name);

  // Directories first: a directory is absorbed by its `<name>.rs` sibling, or
  // speaks for itself through `<name>/mod.rs`.
  for (const directory of directories) {
    const sibling = `${directory}.rs`;
    if (files.has(sibling) && isValidModuleName(directory) && !isImplicitRoot(directory)) {
      claimedFiles.add(sibling);
      nodes.push({
        kind: 'module',
        name: directory,
        file: sibling,
        directory,
        style: 'file',
        declared: declarationOf(directory, false),
        isCrateRoot: false,
        nested: []
      });
      continue;
    }

    if (dirsWithModRs.has(directory) && isValidModuleName(directory)) {
      nodes.push({
        kind: 'module',
        name: directory,
        file: `${directory}/mod.rs`,
        directory,
        style: 'mod-rs',
        declared: declarationOf(directory, false),
        isCrateRoot: false,
        nested: []
      });
      continue;
    }

    nodes.push({ kind: 'directory', name: directory });
  }

  for (const entry of input.entries) {
    if (entry.type !== 'file' || claimedFiles.has(entry.name)) {
      continue;
    }

    // `mod.rs` is the file of the module its directory represents, not a module
    // of its own.
    if (entry.name === 'mod.rs') {
      if (!(input.isModuleDirectory && options.hideModRs)) {
        nodes.push({ kind: 'file', name: entry.name });
      }
      continue;
    }

    const moduleName = moduleNameOf(entry.name);
    if (moduleName === undefined) {
      if (options.showNonRustFiles) {
        nodes.push({ kind: 'file', name: entry.name });
      }
      continue;
    }

    const isCrateRoot = Boolean(input.isCrateRoot) && IMPLICIT_ROOTS.has(moduleName);
    nodes.push({
      kind: 'module',
      name: moduleName,
      file: entry.name,
      style: 'file',
      declared: declarationOf(moduleName, isCrateRoot),
      isCrateRoot,
      nested: []
    });
  }

  const sorted = sortNodes(nodes, options.sortOrder, declared);
  return options.nestCrateRoot && input.isCrateRoot ? nestUnderCrateRoot(sorted) : sorted;
}

/**
 * Pulls the crate's top level modules underneath `lib.rs` (or `main.rs` for a
 * binary-only crate), which is where `mod` declares them.
 */
function nestUnderCrateRoot(nodes: readonly NodeModel[]): NodeModel[] {
  const isRoot = (node: NodeModel, name: string): boolean =>
    node.kind === 'module' && node.name === name && node.isCrateRoot;

  const root = nodes.find((node) => isRoot(node, 'lib')) ?? nodes.find((node) => isRoot(node, 'main'));
  if (root === undefined || root.kind !== 'module') {
    return [...nodes];
  }

  const nested: NodeModel[] = [];
  const rest: NodeModel[] = [];

  for (const node of nodes) {
    if (node === root) {
      rest.push(node);
    } else if (node.kind === 'module' && !node.isCrateRoot) {
      nested.push(node);
    } else {
      rest.push(node);
    }
  }

  if (nested.length === 0) {
    return [...nodes];
  }

  return rest.map((node) => (node === root ? { ...root, nested } : node));
}

function hasChildren(node: NodeModel): boolean {
  if (node.kind === 'directory') {
    return true;
  }
  return node.kind === 'module' && (node.directory !== undefined || node.nested.length > 0);
}

function typeRank(node: NodeModel): number {
  if (hasChildren(node)) {
    return 0;
  }
  return node.kind === 'module' ? 1 : 2;
}

function sortNodes(
  nodes: readonly NodeModel[],
  order: SortOrder,
  declared: readonly string[] | undefined
): NodeModel[] {
  const byName = (a: NodeModel, b: NodeModel): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

  const sorted = [...nodes];

  if (order === 'alphabetical') {
    return sorted.sort(byName);
  }

  if (order === 'declaration' && declared !== undefined) {
    const rank = (node: NodeModel): number => {
      if (node.kind !== 'module') {
        return declared.length + (node.kind === 'directory' ? 1 : 2);
      }
      const index = declared.indexOf(node.name);
      return index === -1 ? declared.length : index;
    };
    return sorted.sort((a, b) => rank(a) - rank(b) || byName(a, b));
  }

  return sorted.sort((a, b) => typeRank(a) - typeRank(b) || byName(a, b));
}

/** What the view knows about a module row when it comes to describe it. */
export interface ModuleRow {
  /** Name of the file a click on the row opens, e.g. `parser.rs` or `mod.rs`. */
  readonly fileName: string;
  /** The row has children, so it reads as a folder. */
  readonly expandable: boolean;
  /** The label already names the file, so repeating it says nothing. */
  readonly labelIsFileName: boolean;
  /** No `mod` statement declares the file, so Rust never compiles it. */
  readonly undeclared: boolean;
}

/**
 * The helper text shown after a module's label.
 *
 * A module that has submodules expands like a folder, but it is also a file:
 * clicking it opens Rust source. Which file that is depends on the layout —
 * `parser.rs` for `parser/`, `mod.rs` for `legacy/`, `lib.rs` for a crate root
 * — so the row names it, and a row that looks like a folder stops hiding the
 * code behind it. A leaf module is only ever a file and needs no such hint,
 * and neither does a row already labelled with its file name.
 */
export function moduleRowDescription(row: ModuleRow): string | undefined {
  const parts: string[] = [];

  if (row.expandable && !row.labelIsFileName) {
    parts.push(row.fileName);
  }
  if (row.undeclared) {
    parts.push('not declared');
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}
