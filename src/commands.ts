import * as vscode from 'vscode';

import { CONFIG_SECTION } from './config';
import {
  computeModInsertion,
  computeModRemoval,
  findModNameRange,
  isValidModuleName,
  type ModVisibility
} from './model/modDeclarations';
import type { RustModuleTreeProvider } from './tree/rustModuleTreeProvider';
import { RustNode } from './tree/rustNode';

/** Where a new module should be created, and which file declares it. */
interface ModuleTarget {
  readonly dir: vscode.Uri;
  readonly ownerFile?: vscode.Uri;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: RustModuleTreeProvider,
  view: vscode.TreeView<RustNode>
): void {
  const register = (command: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  register('rustExplorer.refresh', () => provider.refresh());

  register('rustExplorer.revealActiveEditor', async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      return;
    }
    await revealUri(provider, view, editor.document.uri, true);
  });

  // View title commands arrive without arguments, context menus with the row.
  const asNode = (value: unknown): RustNode | undefined =>
    value instanceof RustNode ? value : undefined;

  register('rustExplorer.newModule', (arg?: unknown) => newModule(provider, asNode(arg)));
  register('rustExplorer.renameModule', (arg?: unknown) => renameNode(provider, asNode(arg)));
  register('rustExplorer.deleteModule', (arg?: unknown) => deleteNode(provider, asNode(arg)));
  register('rustExplorer.declareModule', (arg?: unknown) => declareModule(provider, asNode(arg)));

  register('rustExplorer.openToSide', async (arg?: unknown) => {
    const node = asNode(arg);
    if (node === undefined) {
      return;
    }
    await vscode.window.showTextDocument(node.resource, { viewColumn: vscode.ViewColumn.Beside });
  });

  register('rustExplorer.revealInFileExplorer', async (arg?: unknown) => {
    const node = asNode(arg);
    if (node !== undefined) {
      await vscode.commands.executeCommand('revealInExplorer', node.resource);
    }
  });

  register('rustExplorer.copyPath', async (arg?: unknown) => {
    const node = asNode(arg);
    if (node !== undefined) {
      await vscode.env.clipboard.writeText(node.resource.fsPath);
    }
  });

  register('rustExplorer.copyRelativePath', async (arg?: unknown) => {
    const node = asNode(arg);
    if (node !== undefined) {
      await vscode.env.clipboard.writeText(vscode.workspace.asRelativePath(node.resource, false));
    }
  });
}

export async function revealUri(
  provider: RustModuleTreeProvider,
  view: vscode.TreeView<RustNode>,
  uri: vscode.Uri,
  focus: boolean
): Promise<void> {
  if (uri.scheme !== 'file' || !view.visible) {
    return;
  }
  const node = await provider.findNode(uri);
  if (node === undefined) {
    return;
  }
  await view.reveal(node, { select: true, focus, expand: true });
}

// -- New module -------------------------------------------------------------

async function newModule(provider: RustModuleTreeProvider, node: RustNode | undefined): Promise<void> {
  const target = await resolveTarget(provider, node);
  if (target === undefined) {
    void vscode.window.showWarningMessage('Rust Explorer: open a folder before creating a module.');
    return;
  }

  const relativeDir = vscode.workspace.asRelativePath(target.dir, false);
  const name = await vscode.window.showInputBox({
    title: `New Rust module in ${relativeDir}`,
    prompt: target.ownerFile
      ? `Creates ${relativeDir}/<name>.rs and declares it in ${vscode.workspace.asRelativePath(target.ownerFile, false)}`
      : `Creates ${relativeDir}/<name>.rs`,
    placeHolder: 'module name',
    validateInput: (value) => validateModuleName(value, target.dir)
  });

  const moduleName = name?.trim();
  if (!moduleName) {
    return;
  }

  const file = vscode.Uri.joinPath(target.dir, `${moduleName}.rs`);
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(file, { ignoreIfExists: false, contents: new Uint8Array() });

  const owner = await prepareDeclaration(edit, target.ownerFile, moduleName);
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage(`Rust Explorer: could not create ${moduleName}.rs`);
    return;
  }

  await saveDocuments(owner);
  provider.refresh();
  await vscode.window.showTextDocument(file);
}

/** Adds the `mod <name>;` declaration to `owner`, returning the file that changed. */
async function prepareDeclaration(
  edit: vscode.WorkspaceEdit,
  owner: vscode.Uri | undefined,
  name: string
): Promise<vscode.Uri | undefined> {
  if (owner === undefined) {
    return undefined;
  }

  const document = await openDocument(owner);
  if (document === undefined) {
    return undefined;
  }

  const insertion = computeModInsertion(document.getText(), name, moduleVisibility());
  if (insertion === undefined) {
    return undefined;
  }

  edit.insert(owner, document.positionAt(insertion.offset), insertion.text);
  return owner;
}

async function resolveTarget(
  provider: RustModuleTreeProvider,
  node: RustNode | undefined
): Promise<ModuleTarget | undefined> {
  // Where a module's own submodules go is not always `<name>/`: a crate root
  // declares them next to itself, so `mod` in `src/lib.rs` means `src/foo.rs`
  // and never `src/lib/foo.rs`.
  if (node?.isModule) {
    return {
      dir: node.props.moduleDir ?? (await provider.moduleContentDirectory(node.resource)),
      ownerFile: node.resource
    };
  }

  if (node?.kind === 'directory' || node?.kind === 'workspace') {
    return { dir: node.resource, ownerFile: await detectOwner(node.resource) };
  }

  if (node?.kind === 'file') {
    return { dir: node.props.containerDir, ownerFile: node.props.ownerFile };
  }

  // No selection: fall back to the active Rust file, then to the workspace.
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active !== undefined && active.path.endsWith('.rs')) {
    return { dir: await provider.moduleContentDirectory(active), ownerFile: active };
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    return undefined;
  }
  const src = vscode.Uri.joinPath(folder.uri, 'src');
  const dir = (await exists(src)) ? src : folder.uri;
  return { dir, ownerFile: await detectOwner(dir) };
}

/** The file whose `mod` declarations own `dir`. */
async function detectOwner(dir: vscode.Uri): Promise<vscode.Uri | undefined> {
  for (const candidate of ['mod.rs', 'lib.rs', 'main.rs']) {
    const uri = vscode.Uri.joinPath(dir, candidate);
    if (await exists(uri)) {
      return uri;
    }
  }
  return undefined;
}

// -- Rename -----------------------------------------------------------------

async function renameNode(provider: RustModuleTreeProvider, node: RustNode | undefined): Promise<void> {
  if (node === undefined || node.kind === 'workspace') {
    return;
  }

  if (!node.isModule) {
    await renamePlainEntry(provider, node);
    return;
  }

  const containerDir = node.props.containerDir;
  const newName = await vscode.window.showInputBox({
    title: `Rename module ${node.name}`,
    value: node.name,
    prompt: 'The module file, its directory and the `mod` declaration are renamed together.',
    validateInput: (value) => validateModuleName(value, containerDir, node.name)
  });

  const target = newName?.trim();
  if (!target || target === node.name) {
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  if (node.props.style === 'file') {
    edit.renameFile(node.resource, vscode.Uri.joinPath(containerDir, `${target}.rs`));
  }
  if (node.props.moduleDir !== undefined) {
    edit.renameFile(node.props.moduleDir, vscode.Uri.joinPath(containerDir, target));
  }

  const owner = await replaceDeclarationName(edit, node, target);
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage(`Rust Explorer: could not rename ${node.name}`);
    return;
  }

  await saveDocuments(owner);
  provider.refresh();
}

async function replaceDeclarationName(
  edit: vscode.WorkspaceEdit,
  node: RustNode,
  newName: string
): Promise<vscode.Uri | undefined> {
  const owner = node.props.ownerFile;
  if (owner === undefined || node.props.isCrateRoot) {
    return undefined;
  }

  const document = await openDocument(owner);
  if (document === undefined) {
    return undefined;
  }

  const range = findModNameRange(document.getText(), node.name);
  if (range === undefined) {
    return undefined;
  }

  edit.replace(
    owner,
    new vscode.Range(document.positionAt(range.start), document.positionAt(range.end)),
    newName
  );
  return owner;
}

async function renamePlainEntry(provider: RustModuleTreeProvider, node: RustNode): Promise<void> {
  const containerDir = node.props.containerDir;
  const newName = await vscode.window.showInputBox({
    title: `Rename ${node.name}`,
    value: node.name,
    validateInput: async (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'A name is required.';
      }
      if (trimmed !== node.name && (await exists(vscode.Uri.joinPath(containerDir, trimmed)))) {
        return `${trimmed} already exists.`;
      }
      return undefined;
    }
  });

  const target = newName?.trim();
  if (!target || target === node.name) {
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(node.resource, vscode.Uri.joinPath(containerDir, target));
  await vscode.workspace.applyEdit(edit);
  provider.refresh();
}

// -- Delete -----------------------------------------------------------------

async function deleteNode(provider: RustModuleTreeProvider, node: RustNode | undefined): Promise<void> {
  if (node === undefined || node.kind === 'workspace') {
    return;
  }

  const targets: vscode.Uri[] = [];
  if (node.props.moduleDir !== undefined) {
    targets.push(node.props.moduleDir);
  }
  if (node.props.style !== 'mod-rs') {
    targets.push(node.resource);
  }

  const owner = node.isModule && !node.props.isCrateRoot ? node.props.ownerFile : undefined;
  const removal = owner === undefined ? undefined : await prepareRemoval(owner, node.name);

  const detail = [
    ...targets.map((uri) => `• ${vscode.workspace.asRelativePath(uri, false)}`),
    ...(removal
      ? [`• \`mod ${node.name};\` in ${vscode.workspace.asRelativePath(removal.owner, false)}`]
      : [])
  ].join('\n');

  const confirmation = await vscode.window.showWarningMessage(
    `Delete ${node.isModule ? 'module' : 'file'} '${node.name}'?`,
    { modal: true, detail },
    'Delete'
  );
  if (confirmation !== 'Delete') {
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const uri of targets) {
    edit.deleteFile(uri, { recursive: true, ignoreIfNotExists: true });
  }
  if (removal !== undefined) {
    edit.delete(removal.owner, removal.range);
  }

  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage(`Rust Explorer: could not delete ${node.name}`);
    return;
  }

  await saveDocuments(removal?.owner);
  provider.refresh();
}

async function prepareRemoval(
  owner: vscode.Uri,
  name: string
): Promise<{ owner: vscode.Uri; range: vscode.Range } | undefined> {
  const document = await openDocument(owner);
  if (document === undefined) {
    return undefined;
  }
  const removal = computeModRemoval(document.getText(), name);
  if (removal === undefined) {
    return undefined;
  }
  return {
    owner,
    range: new vscode.Range(document.positionAt(removal.start), document.positionAt(removal.end))
  };
}

// -- Declare ----------------------------------------------------------------

async function declareModule(provider: RustModuleTreeProvider, node: RustNode | undefined): Promise<void> {
  if (node === undefined || !node.isModule) {
    return;
  }

  const owner = node.props.ownerFile;
  if (owner === undefined) {
    void vscode.window.showWarningMessage(
      `Rust Explorer: no owning module found for ${node.name}, so there is nowhere to add \`mod ${node.name};\`.`
    );
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const changed = await prepareDeclaration(edit, owner, node.name);
  if (changed === undefined) {
    void vscode.window.showInformationMessage(`${node.name} is already declared.`);
    provider.refresh();
    return;
  }

  await vscode.workspace.applyEdit(edit);
  await saveDocuments(changed);
  provider.refresh();
}

// -- Helpers ----------------------------------------------------------------

function moduleVisibility(): ModVisibility {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<ModVisibility>('moduleVisibility', 'private');
}

async function validateModuleName(
  value: string,
  dir: vscode.Uri,
  allowed?: string
): Promise<string | undefined> {
  const name = value.trim();
  if (name.length === 0) {
    return 'A module name is required.';
  }
  if (!isValidModuleName(name)) {
    return `'${name}' is not a valid Rust module name.`;
  }
  if (name === allowed) {
    return undefined;
  }
  if (await exists(vscode.Uri.joinPath(dir, `${name}.rs`))) {
    return `${name}.rs already exists.`;
  }
  return undefined;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}

async function saveDocuments(...uris: (vscode.Uri | undefined)[]): Promise<void> {
  for (const uri of uris) {
    if (uri === undefined) {
      continue;
    }
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uri.toString()
    );
    if (document?.isDirty) {
      await document.save();
    }
  }
}
