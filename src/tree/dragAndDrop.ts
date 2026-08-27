import * as vscode from 'vscode';

import type { RustNode } from './rustNode';

/**
 * The mime type every drop target inside VS Code reads — the editor area, the
 * terminal, another window — and the one an extension has to produce for a row
 * to be openable in a split.
 */
const URI_LIST = 'text/uri-list';

/** `text/uri-list` is one URI per line, CRLF separated. */
const URI_LIST_SEPARATOR = '\r\n';

/**
 * Makes the rows of the Rust Modules view draggable. A tree view contributes
 * nothing draggable until it registers a controller, so without this a module
 * cannot be dragged into the editor to open it beside the current file.
 */
export class RustModuleDragController implements vscode.TreeDragAndDropController<RustNode> {
  readonly dragMimeTypes: readonly string[] = [URI_LIST];

  /** Dropping onto the view is not supported yet; rows only drag out. */
  readonly dropMimeTypes: readonly string[] = [];

  handleDrag(source: readonly RustNode[], dataTransfer: vscode.DataTransfer): void {
    const uris = source.filter(isDraggable).map((node) => node.resource.toString());
    if (uris.length === 0) {
      return;
    }
    dataTransfer.set(URI_LIST, new vscode.DataTransferItem(uris.join(URI_LIST_SEPARATOR)));
  }
}

/**
 * A workspace row stands for the open folder itself, and a target that reads a
 * uri list as a move would relocate the whole folder, so it is left undraggable.
 */
function isDraggable(node: RustNode): boolean {
  return node.kind !== 'workspace';
}
