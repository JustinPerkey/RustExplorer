/**
 * Minimal Rust source scanning: which submodules a file declares, and where a
 * new `mod` declaration should go. Everything here is plain string handling so
 * it can be unit tested without VS Code.
 */

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/** Rust keywords that can never be a module name. */
const RESERVED = new Set([
  'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if',
  'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self',
  'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async',
  'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv', 'typeof',
  'unsized', 'virtual', 'yield', 'try'
]);

export function isValidModuleName(name: string): boolean {
  if (name.length === 0 || RESERVED.has(name)) {
    return false;
  }
  if (!IDENT_START.test(name[0])) {
    return false;
  }
  return [...name].every((char) => IDENT_PART.test(char));
}

/**
 * Replaces comments, string literals and char literals with spaces, keeping the
 * length (and therefore every offset) of the original source intact.
 */
export function blankOutCommentsAndStrings(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') {
        out[i] = ' ';
      }
    }
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    // Line comment.
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    // Block comment; Rust allows these to nest.
    if (char === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < source.length && depth > 0) {
        if (source[j] === '/' && source[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (source[j] === '*' && source[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      blank(i, j);
      i = j;
      continue;
    }

    // Raw string: r"..", r#".."#, br##".."##
    const rawMatch = /^b?r(#*)"/.exec(source.slice(i, i + 16));
    if (rawMatch && (char === 'r' || (char === 'b' && next === 'r'))) {
      const hashes = rawMatch[1];
      const terminator = `"${hashes}`;
      const bodyStart = i + rawMatch[0].length;
      const end = source.indexOf(terminator, bodyStart);
      const stop = end === -1 ? source.length : end + terminator.length;
      blank(i, stop);
      i = stop;
      continue;
    }

    // Normal string literal.
    if (char === '"' || (char === 'b' && next === '"')) {
      let j = char === '"' ? i + 1 : i + 2;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }

    // Char literal, but not a lifetime such as `&'a str`.
    if (char === "'") {
      const charLiteral = /^'(?:\\.|[^\\'])'/.exec(source.slice(i, i + 12));
      if (charLiteral) {
        blank(i, i + charLiteral[0].length);
        i += charLiteral[0].length;
        continue;
      }
    }

    i++;
  }

  return out.join('');
}

export interface ModDeclaration {
  readonly name: string;
  /** `mod foo { .. }` declares the module inline instead of in its own file. */
  readonly inline: boolean;
  /** Offset of the `mod` keyword. */
  readonly offset: number;
  /** Offset of the module name. */
  readonly nameOffset: number;
  /** Nesting depth of the enclosing braces; `0` for declarations at file scope. */
  readonly depth: number;
}

/** Finds every `mod` declaration in a Rust source file, in source order. */
export function parseModDeclarations(source: string): ModDeclaration[] {
  const code = blankOutCommentsAndStrings(source);
  const declarations: ModDeclaration[] = [];
  let depth = 0;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];

    if (char === '{') {
      depth++;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char !== 'm' || !code.startsWith('mod', i)) {
      continue;
    }
    const before = i === 0 ? '' : code[i - 1];
    if (before && IDENT_PART.test(before)) {
      continue;
    }
    if (IDENT_PART.test(code[i + 3] ?? '')) {
      continue;
    }

    let j = i + 3;
    while (j < code.length && /\s/.test(code[j])) {
      j++;
    }
    const nameOffset = j;
    let name = '';
    while (j < code.length && IDENT_PART.test(code[j])) {
      name += code[j];
      j++;
    }
    while (j < code.length && /\s/.test(code[j])) {
      j++;
    }
    const terminator = code[j];
    if (name.length === 0 || (terminator !== ';' && terminator !== '{')) {
      continue;
    }

    declarations.push({ name, inline: terminator === '{', offset: i, nameOffset, depth });
  }

  return declarations;
}

/** Module names declared as `mod <name>;` at file scope, in source order. */
export function declaredFileModules(source: string): string[] {
  return parseModDeclarations(source)
    .filter((declaration) => !declaration.inline && declaration.depth === 0)
    .map((declaration) => declaration.name);
}

export interface ModInsertion {
  /** Offset the text should be inserted at. */
  readonly offset: number;
  readonly text: string;
}

export type ModVisibility = 'private' | 'pub' | 'pub(crate)' | 'pub(super)';

function lineStartAt(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

function lineEndAt(source: string, offset: number): number {
  const end = source.indexOf('\n', offset);
  return end === -1 ? source.length : end + 1;
}

function isSorted(names: readonly string[]): boolean {
  return names.every((name, index) => index === 0 || names[index - 1].localeCompare(name) <= 0);
}

/**
 * Works out where to add `mod <name>;` to a Rust file.
 *
 * Existing declarations win: the new one joins them, alphabetically when the
 * block already is. Otherwise the declaration goes below the file header (inner
 * attributes and `//!` docs) and above the rest of the file.
 *
 * Returns `undefined` when the module is already declared.
 */
export function computeModInsertion(
  source: string,
  name: string,
  visibility: ModVisibility = 'private'
): ModInsertion | undefined {
  const declarations = parseModDeclarations(source).filter((declaration) => declaration.depth === 0);
  if (declarations.some((declaration) => declaration.name === name)) {
    return undefined;
  }

  const prefix = visibility === 'private' ? '' : `${visibility} `;
  const statement = `${prefix}mod ${name};`;
  const fileModules = declarations.filter((declaration) => !declaration.inline);

  if (fileModules.length > 0) {
    const names = fileModules.map((declaration) => declaration.name);
    if (isSorted(names)) {
      const successor = fileModules.find((declaration) => declaration.name.localeCompare(name) > 0);
      if (successor) {
        return { offset: lineStartAt(source, successor.offset), text: `${statement}\n` };
      }
    }
    const last = fileModules[fileModules.length - 1];
    return { offset: lineEndAt(source, last.offset), text: `${statement}\n` };
  }

  // No declarations yet: skip the header, then insert.
  const lines = source.split('\n');
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const isHeader = trimmed.length === 0 || trimmed.startsWith('#![') || trimmed.startsWith('//!');
    if (!isHeader) {
      break;
    }
    offset += line.length + 1;
  }
  offset = Math.min(offset, source.length);

  const restIsBlank = source.slice(offset).trim().length === 0;
  return { offset, text: restIsBlank ? `${statement}\n` : `${statement}\n\n` };
}

/** The visibility keyword that precedes `mod` at `offset`, if any. */
function visibilitySpan(code: string, offset: number): number {
  const before = code.slice(0, offset).trimEnd();
  const match = /(?:^|\s)(pub(?:\s*\((?:crate|super|self|in\s+[^)]*)\))?)$/.exec(before);
  if (!match) {
    return offset;
  }
  return before.length - match[1].length;
}

export interface ModRemoval {
  readonly start: number;
  readonly end: number;
}

/**
 * Locates the text to drop when a module goes away: the whole line when the
 * declaration owns it, otherwise just the `pub mod name;` statement.
 */
export function computeModRemoval(source: string, name: string): ModRemoval | undefined {
  const code = blankOutCommentsAndStrings(source);
  const declaration = parseModDeclarations(source).find(
    (candidate) => candidate.name === name && !candidate.inline && candidate.depth === 0
  );
  if (declaration === undefined) {
    return undefined;
  }

  const start = visibilitySpan(code, declaration.offset);
  const semicolon = code.indexOf(';', declaration.nameOffset);
  const end = semicolon === -1 ? source.length : semicolon + 1;

  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineBreak = source.indexOf('\n', end);
  const lineEnd = lineBreak === -1 ? source.length : lineBreak + 1;
  const ownsLine =
    source.slice(lineStart, start).trim().length === 0 && source.slice(end, lineEnd).trim().length === 0;

  return ownsLine ? { start: lineStart, end: lineEnd } : { start, end };
}

/** Range covering just the module name of a `mod <name>;` declaration. */
export function findModNameRange(source: string, name: string): ModRemoval | undefined {
  const declaration = parseModDeclarations(source).find(
    (candidate) => candidate.name === name && !candidate.inline && candidate.depth === 0
  );
  if (declaration === undefined) {
    return undefined;
  }
  return { start: declaration.nameOffset, end: declaration.nameOffset + name.length };
}
