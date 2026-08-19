import * as vscode from 'vscode';

import { registerCommands, revealUri } from './commands';
import { CONFIG_SECTION, readConfig } from './config';
import { ModuleProblemDecorationProvider } from './tree/problemDecorations';
import { RustModuleTreeProvider } from './tree/rustModuleTreeProvider';
import type { RustNode } from './tree/rustNode';

const REFRESH_DEBOUNCE_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new RustModuleTreeProvider();
  const view = vscode.window.createTreeView<RustNode>('rustExplorer.modules', {
    treeDataProvider: provider,
    showCollapseAll: true
  });

  const decorations = new ModuleProblemDecorationProvider(provider);

  context.subscriptions.push(
    view,
    provider,
    decorations,
    vscode.window.registerFileDecorationProvider(decorations)
  );
  registerCommands(context, provider, view);

  const refresh = debounce(() => provider.refresh(), REFRESH_DEBOUNCE_MS);
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');

  const onStructureChange = (uri: vscode.Uri): void => {
    if (provider.isRelevant(uri)) {
      refresh.schedule();
    }
  };

  context.subscriptions.push(
    watcher,
    refresh,
    watcher.onDidCreate(onStructureChange),
    watcher.onDidDelete(onStructureChange),
    // Content only matters for `mod` declarations.
    watcher.onDidChange((uri) => {
      if (uri.path.endsWith('.rs')) {
        onStructureChange(uri);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        provider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void follow(provider, view, editor?.document.uri);
    }),
    view.onDidChangeVisibility((event) => {
      if (event.visible) {
        void follow(provider, view, vscode.window.activeTextEditor?.document.uri);
      }
    })
  );
}

export function deactivate(): void {
  // Everything is disposed through the extension context.
}

async function follow(
  provider: RustModuleTreeProvider,
  view: vscode.TreeView<RustNode>,
  uri: vscode.Uri | undefined
): Promise<void> {
  if (uri === undefined || !readConfig(uri).followActiveEditor) {
    return;
  }
  await revealUri(provider, view, uri, false);
}

interface Debounced extends vscode.Disposable {
  schedule(): void;
}

function debounce(action: () => void, delayMs: number): Debounced {
  let timer: NodeJS.Timeout | undefined;

  return {
    schedule(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        action();
      }, delayMs);
    },
    dispose(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    }
  };
}
