import * as vscode from 'vscode';

import type { ModuleStyle, NodeModel } from '../model/moduleTree';

export type RustNodeKind = 'workspace' | 'module' | 'directory' | 'file';

export interface RustNodeProps {
  /** Directory whose listing produced this node. */
  readonly containerDir: vscode.Uri;
  /** The `.rs` file that declares this node with `mod <name>;`, when known. */
  readonly ownerFile?: vscode.Uri;
  /** Directory holding the module's submodules. */
  readonly moduleDir?: vscode.Uri;
  readonly style?: ModuleStyle;
  readonly declared?: boolean;
  readonly isCrateRoot?: boolean;
  /** Sibling models pulled underneath a crate root. */
  readonly nested?: readonly NodeModel[];
}

/** One row of the Rust Modules view. */
export class RustNode {
  readonly nested: readonly NodeModel[];

  constructor(
    readonly kind: RustNodeKind,
    readonly name: string,
    /** The resource opened when the row is clicked: a `.rs` file, or a directory. */
    readonly resource: vscode.Uri,
    readonly parent: RustNode | undefined,
    readonly props: RustNodeProps
  ) {
    this.nested = props.nested ?? [];
  }

  get id(): string {
    return `${this.kind}:${this.resource.toString()}`;
  }

  get isModule(): boolean {
    return this.kind === 'module';
  }

  get isUndeclared(): boolean {
    return this.props.declared === false;
  }

  get isExpandable(): boolean {
    if (this.kind === 'directory' || this.kind === 'workspace') {
      return true;
    }
    return this.isModule && (this.props.moduleDir !== undefined || this.nested.length > 0);
  }

  /** Directory that holds this node's children, when it has any on disk. */
  get childDir(): vscode.Uri | undefined {
    if (this.kind === 'directory' || this.kind === 'workspace') {
      return this.resource;
    }
    return this.props.moduleDir;
  }

  /**
   * Path prefix covering everything rendered underneath this node, including
   * siblings nested under a crate root.
   */
  get containedPath(): string | undefined {
    const dir = this.childDir;
    if (dir !== undefined) {
      return dir.path;
    }
    return this.nested.length > 0 ? this.props.containerDir.path : undefined;
  }
}
