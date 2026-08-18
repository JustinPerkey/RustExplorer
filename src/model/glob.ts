/**
 * A tiny glob matcher, good enough for `files.exclude`-style patterns.
 *
 * Supported syntax: `*`, `**`, `?`, `{a,b}` and character classes. Patterns are
 * matched against `/`-separated, workspace-relative paths.
 */

const SPECIAL = /[.+^$()|\\]/g;

function escapeLiteral(text: string): string {
  return text.replace(SPECIAL, '\\$&');
}

/** Translates a glob pattern into an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  // A pattern without a separator matches the entry anywhere in the tree.
  const normalized = pattern.includes('/') ? pattern : `**/${pattern}`;
  let source = '';

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    switch (char) {
      case '*': {
        const isGlobstar = normalized[i + 1] === '*';
        if (isGlobstar) {
          i++;
          if (normalized[i + 1] === '/') {
            i++;
            source += '(?:[^/]*/)*';
          } else {
            source += '.*';
          }
        } else {
          source += '[^/]*';
        }
        break;
      }
      case '?':
        source += '[^/]';
        break;
      case '{':
        source += '(?:';
        break;
      case '}':
        source += ')';
        break;
      case ',':
        source += '|';
        break;
      case '[': {
        const end = normalized.indexOf(']', i + 1);
        if (end === -1) {
          source += '\\[';
          break;
        }
        let body = normalized.slice(i + 1, end);
        if (body.startsWith('!')) {
          body = `^${body.slice(1)}`;
        }
        source += `[${body}]`;
        i = end;
        break;
      }
      default:
        source += escapeLiteral(char);
        break;
    }
  }

  // `**/target` should also hide everything below `target`.
  return new RegExp(`^${source}(?:/.*)?$`);
}

/** Matches `relativePath` against every enabled pattern of a `files.exclude` style map. */
export class ExcludeMatcher {
  private readonly patterns: RegExp[];

  constructor(exclude: Readonly<Record<string, boolean>> = {}) {
    this.patterns = Object.entries(exclude)
      .filter(([, enabled]) => enabled)
      .map(([pattern]) => globToRegExp(pattern));
  }

  matches(relativePath: string): boolean {
    return this.patterns.some((pattern) => pattern.test(relativePath));
  }
}
