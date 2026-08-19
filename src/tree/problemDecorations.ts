import * as vscode from 'vscode';

import { readConfig, type RustExplorerConfig } from '../config';
import {
  hasProblems,
  problemBadge,
  problemTooltip,
  rollupTargets,
  summarizeProblemsUnder,
  type ProblemMarker,
  type ProblemSeverity
} from '../model/problems';

/** What the decorations need to know about the shape of the view. */
export interface ModuleLayout {
  /** Directory a `.rs` file stands in for, when its row folds one away. */
  coveredDirectory(file: vscode.Uri): Promise<vscode.Uri | undefined>;
  /** False for paths the view hides. */
  isRelevant(uri: vscode.Uri): boolean;
  /** Fires when the view was rebuilt, so cached answers are stale. */
  readonly onDidChangeTreeData: vscode.Event<unknown>;
}

/** Beyond this many rows, re-asking for everything is cheaper than listing them. */
const MAX_TARGETS = 200;

/**
 * Colours a row after the worst problem hiding underneath it.
 *
 * VS Code decorates a folder with the errors and warnings of its contents, but a
 * module row points at `parser.rs`, not at `parser/`, so nothing bubbles up to
 * it: a collapsed module looked healthy while its submodules were broken. This
 * provider fills that gap for the rows that speak for a directory.
 */
export class ModuleProblemDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri[] | undefined> =
    this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private config: RustExplorerConfig = readConfig();
  private markers: ProblemMarker[] | undefined;

  constructor(private readonly layout: ModuleLayout) {
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics((event) => this.onDiagnosticsChanged(event.uris)),
      layout.onDidChangeTreeData(() => this.refresh())
    );
  }

  /** Re-reads the configuration and drops every cached answer. */
  refresh(): void {
    this.config = readConfig();
    this.markers = undefined;
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  async provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<vscode.FileDecoration | undefined> {
    if (!this.config.rollUpProblems || uri.scheme !== 'file') {
      return undefined;
    }

    const markers = this.snapshot();
    if (markers.length === 0) {
      return undefined;
    }

    const isRustFile = uri.path.endsWith('.rs');
    // Anything else is only interesting as a directory, and a directory is
    // exactly a path other files sit underneath -- no `stat` needed to tell.
    const covered = isRustFile ? await this.layout.coveredDirectory(uri) : uri;
    if (covered === undefined || token.isCancellationRequested) {
      return undefined;
    }

    const summary = summarizeProblemsUnder(markers, covered.path, uri.path);
    if (!hasProblems(summary)) {
      return undefined;
    }

    return new vscode.FileDecoration(
      problemBadge(summary),
      problemTooltip(summary, isRustFile ? 'module' : 'folder'),
      new vscode.ThemeColor(summary.errors > 0 ? 'list.errorForeground' : 'list.warningForeground')
    );
  }

  private onDiagnosticsChanged(uris: readonly vscode.Uri[]): void {
    this.markers = undefined;

    const targets = new Map<string, vscode.Uri>();
    for (const uri of uris) {
      if (uri.scheme !== 'file') {
        continue;
      }
      const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.path;
      for (const path of rollupTargets(uri.path, root)) {
        targets.set(path, uri.with({ path, query: '', fragment: '' }));
        if (targets.size > MAX_TARGETS) {
          this.changeEmitter.fire(undefined);
          return;
        }
      }
    }

    if (targets.size > 0) {
      this.changeEmitter.fire([...targets.values()]);
    }
  }

  /** Every error and warning currently reported, kept until diagnostics change. */
  private snapshot(): readonly ProblemMarker[] {
    if (this.markers !== undefined) {
      return this.markers;
    }

    const markers: ProblemMarker[] = [];
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      if (uri.scheme !== 'file' || !this.layout.isRelevant(uri)) {
        continue;
      }
      for (const diagnostic of diagnostics) {
        const severity = severityOf(diagnostic.severity);
        if (severity !== undefined) {
          markers.push({ path: uri.path, severity });
        }
      }
    }

    this.markers = markers;
    return markers;
  }
}

function severityOf(severity: vscode.DiagnosticSeverity): ProblemSeverity | undefined {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    default:
      return undefined;
  }
}
