import * as vscode from 'vscode';

import { readConfig, type RustExplorerConfig } from '../config';
import { ExcludeMatcher } from '../model/glob';
import { declaredFileModules, isValidModuleName } from '../model/modDeclarations';
import {
  IMPLICIT_ROOTS,
  buildDirectoryModel,
  moduleRowDescription,
  type DirEntry,
  type NodeModel
} from '../model/moduleTree';
import { RustNode } from './rustNode';

const ROOT_KEY = '';

/** Files that root a crate and are therefore never declared by a `mod` statement. */
const CRATE_ROOT_FILES = ['lib.rs', 'main.rs'];

export class RustModuleTreeProvider implements vscode.TreeDataProvider<RustNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<RustNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<RustNode | undefined> = this.changeEmitter.event;

  private readonly childrenCache = new Map<string, RustNode[]>();
  private readonly declarationCache = new Map<string, readonly string[]>();
  private readonly crateRootCache = new Map<string, boolean>();
  private readonly crateRootFileCache = new Map<string, string | undefined>();

  private config: RustExplorerConfig = readConfig();
  private excludes = new ExcludeMatcher(this.config.exclude);

  refresh(): void {
    this.config = readConfig();
    this.excludes = new ExcludeMatcher(this.config.exclude);
    this.childrenCache.clear();
    this.declarationCache.clear();
    this.crateRootCache.clear();
    this.crateRootFileCache.clear();
    this.changeEmitter.fire(undefined);
  }

  /** True when a changed path is rendered by this view at all. */
  isRelevant(uri: vscode.Uri): boolean {
    return !this.excludes.matches(vscode.workspace.asRelativePath(uri, false));
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  // -- Tree data ------------------------------------------------------------

  getTreeItem(node: RustNode): vscode.TreeItem {
    const item = new vscode.TreeItem(this.labelOf(node), this.collapsibleStateOf(node));
    item.id = node.id;
    item.resourceUri = node.resource;
    item.contextValue = this.contextValueOf(node);
    item.tooltip = this.tooltipOf(node);

    const description = this.descriptionOf(node);
    if (description !== undefined) {
      item.description = description;
    }

    if (node.kind === 'module' || node.kind === 'file') {
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [node.resource]
      };
    }

    return item;
  }

  getParent(node: RustNode): RustNode | undefined {
    return node.parent;
  }

  async getChildren(element?: RustNode): Promise<RustNode[]> {
    const key = element?.id ?? ROOT_KEY;
    const cached = this.childrenCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const children = await this.loadChildren(element);
    this.childrenCache.set(key, children);
    return children;
  }

  private async loadChildren(element?: RustNode): Promise<RustNode[]> {
    if (element === undefined) {
      return this.loadRoots();
    }

    const children: RustNode[] = [];

    if (element.isModule) {
      if (element.nested.length > 0) {
        children.push(
          ...this.materialize(element.nested, element.props.containerDir, element.resource, element)
        );
      }
      const moduleDir = element.props.moduleDir;
      if (moduleDir !== undefined) {
        children.push(...(await this.scan(moduleDir, element, element.resource, true)));
      }
      return children;
    }

    const dir = element.childDir;
    return dir === undefined ? [] : this.scan(dir, element, undefined, false);
  }

  private async loadRoots(): Promise<RustNode[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return [];
    }
    if (folders.length === 1) {
      return this.scan(folders[0].uri, undefined, undefined, false);
    }
    return folders.map(
      (folder) =>
        new RustNode('workspace', folder.name, folder.uri, undefined, { containerDir: folder.uri })
    );
  }

  // -- Scanning -------------------------------------------------------------

  private async scan(
    dir: vscode.Uri,
    parent: RustNode | undefined,
    ownerFileHint: vscode.Uri | undefined,
    isModuleDirectory: boolean
  ): Promise<RustNode[]> {
    const entries = await this.readVisibleEntries(dir);
    const isCrateRoot = await this.isCrateSourceDir(dir);

    let ownerFile = ownerFileHint;
    if (ownerFile === undefined && isCrateRoot) {
      const rootFile = CRATE_ROOT_FILES.find((name) =>
        entries.some((entry) => entry.type === 'file' && entry.name === name)
      );
      ownerFile = rootFile === undefined ? undefined : vscode.Uri.joinPath(dir, rootFile);
    }

    const [dirsWithModRs, declaredModules] = await Promise.all([
      this.findModuleDirectories(dir, entries),
      this.readDeclarations(ownerFile)
    ]);

    const models = buildDirectoryModel(
      { entries, dirsWithModRs, declaredModules, isCrateRoot, isModuleDirectory },
      this.config
    );

    return this.materialize(models, dir, ownerFile, parent);
  }

  private materialize(
    models: readonly NodeModel[],
    containerDir: vscode.Uri,
    ownerFile: vscode.Uri | undefined,
    parent: RustNode | undefined
  ): RustNode[] {
    return models.map((model) => {
      if (model.kind !== 'module') {
        return new RustNode(model.kind, model.name, vscode.Uri.joinPath(containerDir, model.name), parent, {
          containerDir,
          ownerFile
        });
      }

      return new RustNode(
        'module',
        model.name,
        vscode.Uri.joinPath(containerDir, ...model.file.split('/')),
        parent,
        {
          containerDir,
          ownerFile,
          moduleDir:
            model.directory === undefined ? undefined : vscode.Uri.joinPath(containerDir, model.directory),
          style: model.style,
          declared: model.declared,
          isCrateRoot: model.isCrateRoot,
          nested: model.nested
        }
      );
    });
  }

  private async readVisibleEntries(dir: vscode.Uri): Promise<DirEntry[]> {
    let listing: [string, vscode.FileType][];
    try {
      listing = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return [];
    }

    const entries: DirEntry[] = [];
    for (const [name, fileType] of listing) {
      const child = vscode.Uri.joinPath(dir, name);
      if (this.excludes.matches(vscode.workspace.asRelativePath(child, false))) {
        continue;
      }
      if (fileType & vscode.FileType.Directory) {
        entries.push({ name, type: 'directory' });
      } else if (fileType & vscode.FileType.File) {
        entries.push({ name, type: 'file' });
      }
    }
    return entries;
  }

  /** Sub-directories that carry their own `mod.rs` (2015 edition layout). */
  private async findModuleDirectories(
    dir: vscode.Uri,
    entries: readonly DirEntry[]
  ): Promise<Set<string>> {
    const files = new Set(entries.filter((entry) => entry.type === 'file').map((entry) => entry.name));
    const candidates = entries
      .filter((entry) => entry.type === 'directory' && !files.has(`${entry.name}.rs`))
      .map((entry) => entry.name);

    const found = await Promise.all(
      candidates.map(async (name) => {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, name, 'mod.rs'));
          return name;
        } catch {
          return undefined;
        }
      })
    );

    return new Set(found.filter((name): name is string => name !== undefined));
  }

  /** A `src` directory next to a `Cargo.toml` holds crate roots. */
  private async isCrateSourceDir(dir: vscode.Uri): Promise<boolean> {
    const cached = this.crateRootCache.get(dir.path);
    if (cached !== undefined) {
      return cached;
    }

    let result = false;
    if (dir.path.split('/').pop() === 'src') {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, '..', 'Cargo.toml'));
        result = true;
      } catch {
        result = false;
      }
    }

    this.crateRootCache.set(dir.path, result);
    return result;
  }

  /**
   * The directory a `.rs` file stands for in this view, which is where the rows
   * it hides live: `parser/` for `parser.rs`, its own directory for a `mod.rs`,
   * and the crate's `src` for the root that nests its siblings. `undefined` when
   * the file's row hides nothing.
   */
  async coveredDirectory(file: vscode.Uri): Promise<vscode.Uri | undefined> {
    const name = file.path.split('/').pop() ?? '';
    if (!name.endsWith('.rs')) {
      return undefined;
    }

    const dir = vscode.Uri.joinPath(file, '..');
    if (name === 'mod.rs') {
      return dir;
    }

    const stem = name.slice(0, -'.rs'.length);
    if (!isValidModuleName(stem)) {
      return undefined;
    }

    // A crate root owns no `lib/` of its own: it speaks for the modules that sit
    // next to it in `src`, and only while they are nested underneath it.
    if (IMPLICIT_ROOTS.has(stem) && (await this.isCrateSourceDir(dir))) {
      const nests = this.config.nestCrateRoot && name === (await this.crateRootFile(dir));
      return nests ? dir : undefined;
    }

    return vscode.Uri.joinPath(dir, stem);
  }

  /** The file a crate's top level modules are nested under: `lib.rs`, else `main.rs`. */
  private async crateRootFile(dir: vscode.Uri): Promise<string | undefined> {
    if (this.crateRootFileCache.has(dir.path)) {
      return this.crateRootFileCache.get(dir.path);
    }

    let found: string | undefined;
    for (const name of CRATE_ROOT_FILES) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, name));
        found = name;
        break;
      } catch {
        // Keep looking.
      }
    }

    this.crateRootFileCache.set(dir.path, found);
    return found;
  }

  private async readDeclarations(file: vscode.Uri | undefined): Promise<readonly string[] | undefined> {
    if (file === undefined) {
      return undefined;
    }
    if (!this.config.markUndeclaredModules && this.config.sortOrder !== 'declaration') {
      return undefined;
    }

    const key = file.toString();
    const cached = this.declarationCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let declarations: readonly string[] = [];
    try {
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
      const text = open?.getText() ?? new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
      declarations = declaredFileModules(text);
    } catch {
      declarations = [];
    }

    this.declarationCache.set(key, declarations);
    return declarations;
  }

  // -- Lookup ---------------------------------------------------------------

  /** Finds the node rendering `target`, expanding the tree along the way. */
  async findNode(target: vscode.Uri): Promise<RustNode | undefined> {
    let level = await this.getChildren();

    for (let depth = 0; depth < 64; depth++) {
      const match = level.find((node) => node.resource.path === target.path);
      if (match !== undefined) {
        return match;
      }

      const container = level
        .filter((node) => {
          const path = node.containedPath;
          return path !== undefined && target.path.startsWith(`${path}/`);
        })
        // Prefer the most specific container, e.g. `src/parser` over `src`.
        .sort((a, b) => (b.containedPath?.length ?? 0) - (a.containedPath?.length ?? 0))[0];

      if (container === undefined) {
        return undefined;
      }
      level = await this.getChildren(container);
    }

    return undefined;
  }

  // -- Presentation ---------------------------------------------------------

  private labelOf(node: RustNode): string {
    if (node.kind !== 'module') {
      return node.name;
    }
    if (this.config.labelStyle === 'file' && node.props.style === 'file') {
      return `${node.name}.rs`;
    }
    return node.name;
  }

  private collapsibleStateOf(node: RustNode): vscode.TreeItemCollapsibleState {
    if (!node.isExpandable) {
      return vscode.TreeItemCollapsibleState.None;
    }
    return node.kind === 'workspace'
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
  }

  private contextValueOf(node: RustNode): string {
    if (node.kind !== 'module') {
      return node.kind;
    }
    const flags = ['module'];
    if (node.props.style === 'mod-rs') {
      flags.push('modrs');
    }
    if (node.props.isCrateRoot) {
      flags.push('crateRoot');
    }
    if (this.config.markUndeclaredModules && node.isUndeclared) {
      flags.push('undeclared');
    }
    return flags.join('.');
  }

  private descriptionOf(node: RustNode): string | undefined {
    if (!node.isModule) {
      return undefined;
    }

    const fileName = fileNameOf(node);
    return moduleRowDescription({
      fileName,
      expandable: node.isExpandable,
      labelIsFileName: this.labelOf(node) === fileName,
      undeclared: this.config.markUndeclaredModules && node.isUndeclared
    });
  }

  private tooltipOf(node: RustNode): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`\`${vscode.workspace.asRelativePath(node.resource, false)}\``);

    if (node.isModule) {
      tooltip.appendMarkdown(`\n\nModule \`${modulePathOf(node)}\``);
      if (node.isExpandable) {
        tooltip.appendMarkdown(
          `\n\nClicking the row opens \`${fileNameOf(node)}\`; the arrow expands its submodules.`
        );
      }
      if (this.config.markUndeclaredModules && node.isUndeclared && node.props.ownerFile !== undefined) {
        const owner = vscode.workspace.asRelativePath(node.props.ownerFile, false);
        tooltip.appendMarkdown(
          `\n\n$(warning) Not declared: \`${owner}\` has no \`mod ${node.name};\`, so this file is not compiled.`
        );
        tooltip.supportThemeIcons = true;
      }
    }

    return tooltip;
  }
}

/** Name of the file a row opens, e.g. `parser.rs` or `mod.rs`. */
function fileNameOf(node: RustNode): string {
  return node.resource.path.split('/').pop() ?? node.name;
}

/** Builds the Rust path of a module from its ancestry, e.g. `crate::parser::lexer`. */
export function modulePathOf(node: RustNode): string {
  const segments: string[] = [];
  let current: RustNode | undefined = node;

  while (current !== undefined && current.isModule) {
    if (current.props.isCrateRoot) {
      segments.unshift('crate');
      return segments.join('::');
    }
    segments.unshift(current.name);
    current = current.parent;
  }

  return segments.join('::');
}
