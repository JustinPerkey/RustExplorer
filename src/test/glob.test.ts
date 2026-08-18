import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ExcludeMatcher, globToRegExp } from '../model/glob';

describe('globToRegExp', () => {
  it('matches a bare name anywhere in the tree', () => {
    const pattern = globToRegExp('**/target');

    assert.equal(pattern.test('target'), true);
    assert.equal(pattern.test('crates/core/target'), true);
    // Everything below an excluded directory is excluded too.
    assert.equal(pattern.test('target/debug/build'), true);
    assert.equal(pattern.test('src/targeting.rs'), false);
  });

  it('keeps * inside a single path segment', () => {
    const pattern = globToRegExp('src/*.rs');

    assert.equal(pattern.test('src/lib.rs'), true);
    assert.equal(pattern.test('src/parser/lexer.rs'), false);
  });

  it('supports alternation and single character wildcards', () => {
    assert.equal(globToRegExp('**/*.{toml,lock}').test('Cargo.toml'), true);
    assert.equal(globToRegExp('**/*.{toml,lock}').test('Cargo.lock'), true);
    assert.equal(globToRegExp('**/*.{toml,lock}').test('Cargo.json'), false);
    assert.equal(globToRegExp('v?.rs').test('v1.rs'), true);
  });

  it('escapes regular expression characters in literals', () => {
    assert.equal(globToRegExp('**/a+b.rs').test('a+b.rs'), true);
    assert.equal(globToRegExp('**/a+b.rs').test('aab.rs'), false);
  });
});

describe('ExcludeMatcher', () => {
  it('only applies patterns that are switched on', () => {
    const matcher = new ExcludeMatcher({ '**/target': true, '**/docs': false });

    assert.equal(matcher.matches('target'), true);
    assert.equal(matcher.matches('docs'), false);
    assert.equal(matcher.matches('src/lib.rs'), false);
  });

  it('matches nothing when nothing is configured', () => {
    assert.equal(new ExcludeMatcher().matches('anything'), false);
  });
});
