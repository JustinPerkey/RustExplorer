import * as vscode from 'vscode';

import type { BuildOptions, SortOrder } from './model/moduleTree';

export const CONFIG_SECTION = 'rustExplorer';

export type LabelStyle = 'module' | 'file';

export interface RustExplorerConfig extends BuildOptions {
  readonly markUndeclaredModules: boolean;
  readonly followActiveEditor: boolean;
  readonly labelStyle: LabelStyle;
  readonly exclude: Readonly<Record<string, boolean>>;
}

export function readConfig(scope?: vscode.Uri): RustExplorerConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, scope ?? null);

  return {
    nestCrateRoot: config.get<boolean>('nestCrateRoot', true),
    hideModRs: config.get<boolean>('hideModRs', true),
    showNonRustFiles: config.get<boolean>('showNonRustFiles', true),
    sortOrder: config.get<SortOrder>('sortOrder', 'type'),
    markUndeclaredModules: config.get<boolean>('markUndeclaredModules', true),
    followActiveEditor: config.get<boolean>('followActiveEditor', true),
    labelStyle: config.get<LabelStyle>('labelStyle', 'module'),
    exclude: config.get<Record<string, boolean>>('exclude', {})
  };
}
