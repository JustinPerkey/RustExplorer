import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasProblems,
  isUnder,
  problemBadge,
  problemTooltip,
  rollupTargets,
  summarizeProblemsUnder,
  type ProblemMarker
} from '../model/problems';

function markers(...entries: string[]): ProblemMarker[] {
  return entries.map((entry) => {
    const [path, severity] = entry.split(' ');
    assert.ok(severity === 'error' || severity === 'warning', `bad severity in '${entry}'`);
    return { path, severity };
  });
}

describe('isUnder', () => {
  it('accepts a file below the directory', () => {
    assert.equal(isUnder('/w/src/parser/ast.rs', '/w/src/parser'), true);
    assert.equal(isUnder('/w/src/parser/deep/ast.rs', '/w/src/parser'), true);
  });

  it('rejects the directory itself and look-alike siblings', () => {
    assert.equal(isUnder('/w/src/parser', '/w/src/parser'), false);
    assert.equal(isUnder('/w/src/parser2/ast.rs', '/w/src/parser'), false);
    assert.equal(isUnder('/w/src/parser.rs', '/w/src/parser'), false);
  });
});

describe('summarizeProblemsUnder', () => {
  const all = markers(
    '/w/src/parser.rs warning',
    '/w/src/parser/ast.rs error',
    '/w/src/parser/ast.rs warning',
    '/w/src/parser/lexer.rs error',
    '/w/src/util/text.rs error'
  );

  it('counts every marker below the directory', () => {
    assert.deepEqual(summarizeProblemsUnder(all, '/w/src/parser'), { errors: 2, warnings: 1 });
  });

  it('ignores markers outside the directory', () => {
    assert.deepEqual(summarizeProblemsUnder(all, '/w/src/util'), { errors: 1, warnings: 0 });
  });

  it('leaves out the file the row already stands for', () => {
    assert.deepEqual(summarizeProblemsUnder(all, '/w/src', '/w/src/parser.rs'), {
      errors: 3,
      warnings: 1
    });
  });

  it('reports nothing for a clean subtree', () => {
    const summary = summarizeProblemsUnder(all, '/w/src/clean');
    assert.deepEqual(summary, { errors: 0, warnings: 0 });
    assert.equal(hasProblems(summary), false);
  });
});

describe('problemBadge', () => {
  it('prefers errors over warnings', () => {
    assert.equal(problemBadge({ errors: 2, warnings: 7 }), '2');
    assert.equal(problemBadge({ errors: 0, warnings: 7 }), '7');
  });

  it('stays within two characters', () => {
    assert.equal(problemBadge({ errors: 9, warnings: 0 }), '9');
    assert.equal(problemBadge({ errors: 12, warnings: 0 }), '9+');
  });

  it('has no badge without problems', () => {
    assert.equal(problemBadge({ errors: 0, warnings: 0 }), undefined);
  });
});

describe('problemTooltip', () => {
  it('spells out both counts', () => {
    assert.equal(
      problemTooltip({ errors: 1, warnings: 2 }, 'module'),
      '1 error, 2 warnings inside this module'
    );
    assert.equal(problemTooltip({ errors: 0, warnings: 1 }, 'folder'), '1 warning inside this folder');
  });

  it('has no tooltip without problems', () => {
    assert.equal(problemTooltip({ errors: 0, warnings: 0 }, 'module'), undefined);
  });
});

describe('rollupTargets', () => {
  it('covers every row that can stand for an ancestor directory', () => {
    const targets = rollupTargets('/w/src/parser/ast.rs', '/w');

    assert.ok(targets.includes('/w/src/parser'), 'the directory itself');
    assert.ok(targets.includes('/w/src/parser.rs'), 'the file that absorbs it');
    assert.ok(targets.includes('/w/src/parser/mod.rs'), 'its own mod.rs');
    assert.ok(targets.includes('/w/src/lib.rs'), 'the crate root above it');
    assert.ok(targets.includes('/w/src/main.rs'), 'a binary crate root');
    assert.ok(targets.includes('/w'), 'the workspace row');
  });

  it('stops at the workspace root', () => {
    const targets = rollupTargets('/w/src/ast.rs', '/w');
    assert.ok(!targets.some((target) => target === '/' || target.startsWith('/w.rs')));
    assert.ok(!targets.includes('/home'));
  });

  it('walks to the top without a root', () => {
    assert.deepEqual(rollupTargets('/a.rs'), []);
    assert.ok(rollupTargets('/w/a.rs').includes('/w'));
  });
});
