import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blankOutCommentsAndStrings,
  computeModInsertion,
  computeModRemoval,
  declaredFileModules,
  findModNameRange,
  isValidModuleName,
  parseModDeclarations
} from '../model/modDeclarations';

function applyInsertion(source: string, name: string): string {
  const insertion = computeModInsertion(source, name);
  assert.ok(insertion, `expected an insertion point for '${name}'`);
  return source.slice(0, insertion.offset) + insertion.text + source.slice(insertion.offset);
}

function applyRemoval(source: string, name: string): string {
  const removal = computeModRemoval(source, name);
  assert.ok(removal, `expected '${name}' to be declared`);
  return source.slice(0, removal.start) + source.slice(removal.end);
}

describe('isValidModuleName', () => {
  it('accepts identifiers and rejects everything else', () => {
    for (const name of ['parser', '_private', 'v2', 'snake_case']) {
      assert.equal(isValidModuleName(name), true, name);
    }
    for (const name of ['', '2fast', 'my-module', 'my.module', 'mod', 'crate', 'self']) {
      assert.equal(isValidModuleName(name), false, name);
    }
  });
});

describe('blankOutCommentsAndStrings', () => {
  it('keeps every offset intact', () => {
    const source = 'let s = "mod fake;"; // mod also_fake;\nmod real;';
    assert.equal(blankOutCommentsAndStrings(source).length, source.length);
  });

  it('handles nested block comments and raw strings', () => {
    const source = '/* outer /* inner mod a; */ still comment */ mod b; r#"mod c;"#';
    assert.deepEqual(declaredFileModules(source), ['b']);
  });

  it('does not confuse a lifetime with a char literal', () => {
    const source = "struct Holder<'a> { name: &'a str }\nmod real;";
    assert.deepEqual(declaredFileModules(source), ['real']);
  });
});

describe('parseModDeclarations', () => {
  it('finds file modules and ignores lookalikes', () => {
    const source = [
      '//! mod doc_comment;',
      '// mod commented_out;',
      'use foo::module;',
      'pub mod parser;',
      'pub(crate) mod util;',
      'mod tests_helper;',
      'fn f() { let s = "mod from_string;"; }'
    ].join('\n');

    assert.deepEqual(declaredFileModules(source), ['parser', 'util', 'tests_helper']);
  });

  it('records inline modules and their depth', () => {
    const source = 'mod outer {\n    mod inner;\n}\nmod sibling;';
    const declarations = parseModDeclarations(source);

    assert.deepEqual(
      declarations.map((declaration) => [declaration.name, declaration.inline, declaration.depth]),
      [
        ['outer', true, 0],
        ['inner', false, 1],
        ['sibling', false, 0]
      ]
    );
    // Only file scope declarations describe the sibling files on disk.
    assert.deepEqual(declaredFileModules(source), ['sibling']);
  });

  it('reports the offset of the module name', () => {
    const source = 'pub mod parser;';
    const range = findModNameRange(source, 'parser');
    assert.ok(range);
    assert.equal(source.slice(range.start, range.end), 'parser');
  });
});

describe('computeModInsertion', () => {
  it('keeps an alphabetical block alphabetical', () => {
    const source = 'mod alpha;\nmod gamma;\n';
    assert.equal(applyInsertion(source, 'beta'), 'mod alpha;\nmod beta;\nmod gamma;\n');
  });

  it('appends after the last declaration when the block is unsorted', () => {
    const source = 'mod gamma;\nmod alpha;\n';
    assert.equal(applyInsertion(source, 'beta'), 'mod gamma;\nmod alpha;\nmod beta;\n');
  });

  it('preserves the visibility of the new declaration', () => {
    const insertion = computeModInsertion('mod alpha;\n', 'beta', 'pub(crate)');
    assert.equal(insertion?.text, 'pub(crate) mod beta;\n');
  });

  it('inserts below the file header when there are no declarations yet', () => {
    const source = '#![allow(dead_code)]\n//! Crate docs.\n\nuse std::fmt;\n\npub fn run() {}\n';
    assert.equal(
      applyInsertion(source, 'parser'),
      '#![allow(dead_code)]\n//! Crate docs.\n\nmod parser;\n\nuse std::fmt;\n\npub fn run() {}\n'
    );
  });

  it('handles an empty file', () => {
    assert.equal(applyInsertion('', 'parser'), 'mod parser;\n');
  });

  it('returns nothing when the module is already declared', () => {
    assert.equal(computeModInsertion('pub mod parser;\n', 'parser'), undefined);
    assert.equal(computeModInsertion('mod parser { }\n', 'parser'), undefined);
  });
});

describe('computeModRemoval', () => {
  it('removes the whole line the declaration owns', () => {
    const source = 'mod alpha;\npub(crate) mod beta;\nmod gamma;\n';
    assert.equal(applyRemoval(source, 'beta'), 'mod alpha;\nmod gamma;\n');
  });

  it('removes only the statement when it shares a line', () => {
    const source = 'mod alpha; mod beta;\n';
    assert.equal(applyRemoval(source, 'beta'), 'mod alpha; \n');
  });

  it('returns nothing for an undeclared module', () => {
    assert.equal(computeModRemoval('mod alpha;\n', 'beta'), undefined);
  });
});
