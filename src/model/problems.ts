/**
 * Rolling the problems of a subtree up onto the row that stands for it.
 *
 * A module row hides a whole directory: `parser.rs` speaks for `parser/`, and a
 * crate root speaks for the modules sitting next to it. VS Code bubbles its own
 * error and warning decorations along real folder paths only, so those rows stay
 * clean while something underneath them is broken. The counting lives here, free
 * of VS Code APIs, so it can be unit tested.
 */

export type ProblemSeverity = 'error' | 'warning';

export interface ProblemMarker {
  /** Path of the file the problem belongs to. */
  readonly path: string;
  readonly severity: ProblemSeverity;
}

export interface ProblemSummary {
  readonly errors: number;
  readonly warnings: number;
}

export const NO_PROBLEMS: ProblemSummary = { errors: 0, warnings: 0 };

export function hasProblems(summary: ProblemSummary): boolean {
  return summary.errors > 0 || summary.warnings > 0;
}

/** True when `path` names something strictly underneath `dirPath`. */
export function isUnder(path: string, dirPath: string): boolean {
  return path.startsWith(`${dirPath}/`);
}

/**
 * Counts the markers below `dirPath`. Markers of `ownFile` are left out: that is
 * the file the row opens, and VS Code already decorates it on its own.
 */
export function summarizeProblemsUnder(
  markers: Iterable<ProblemMarker>,
  dirPath: string,
  ownFile?: string
): ProblemSummary {
  let errors = 0;
  let warnings = 0;

  for (const marker of markers) {
    if (marker.path === ownFile || !isUnder(marker.path, dirPath)) {
      continue;
    }
    if (marker.severity === 'error') {
      errors++;
    } else {
      warnings++;
    }
  }

  return { errors, warnings };
}

/** Badges hold two characters at most. */
const MAX_BADGE_COUNT = 9;

/** The badge of a rolled up row: the error count, or the warning count when there are none. */
export function problemBadge(summary: ProblemSummary): string | undefined {
  const count = summary.errors > 0 ? summary.errors : summary.warnings;
  if (count === 0) {
    return undefined;
  }
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count);
}

export function problemTooltip(summary: ProblemSummary, container: string): string | undefined {
  const parts: string[] = [];
  if (summary.errors > 0) {
    parts.push(plural(summary.errors, 'error'));
  }
  if (summary.warnings > 0) {
    parts.push(plural(summary.warnings, 'warning'));
  }
  return parts.length === 0 ? undefined : `${parts.join(', ')} inside this ${container}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The rows whose rolled up counts can change when the problems of `path` do:
 * every ancestor directory up to `root`, plus the `.rs` files that can stand in
 * for one of them.
 */
export function rollupTargets(path: string, root?: string): string[] {
  const targets: string[] = [];

  for (let dir = parentPath(path); dir !== undefined; dir = parentPath(dir)) {
    const atRoot = root !== undefined && !isUnder(dir, root);
    targets.push(dir, `${dir}/mod.rs`, `${dir}/lib.rs`, `${dir}/main.rs`);
    if (atRoot) {
      // `<root>.rs` lives outside the workspace; nothing rolls up into it.
      break;
    }
    targets.push(`${dir}.rs`);
  }

  return targets;
}

function parentPath(path: string): string | undefined {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? undefined : path.slice(0, slash);
}
