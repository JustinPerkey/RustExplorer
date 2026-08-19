import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_BUILD_OPTIONS,
  buildDirectoryModel,
  moduleRowDescription,
  type BuildInput,
  type BuildOptions,
  type DirEntry,
  type ModuleModel,
  type NodeModel
} from '../model/moduleTree';

/** `'foo.rs'` is a file, `'foo/'` is a directory. */
function entries(...names: string[]): DirEntry[] {
  return names.map((name) =>
    name.endsWith('/')
      ? { name: name.slice(0, -1), type: 'directory' as const }
      : { name, type: 'file' as const }
  );
}

function build(input: BuildInput, options: Partial<BuildOptions> = {}): NodeModel[] {
  return buildDirectoryModel(input, { ...DEFAULT_BUILD_OPTIONS, ...options });
}

function module(nodes: readonly NodeModel[], name: string): ModuleModel {
  const found = nodes.find((node) => node.kind === 'module' && node.name === name);
  assert.ok(found && found.kind === 'module', `expected a module named '${name}' in ${describeNodes(nodes)}`);
  return found;
}

function describeNodes(nodes: readonly NodeModel[]): string {
  return JSON.stringify(nodes.map((node) => `${node.kind}:${node.name}`));
}

describe('buildDirectoryModel', () => {
  it('nests a directory under its sibling .rs file', () => {
    const nodes = build({ entries: entries('parser.rs', 'parser/', 'util.rs') });

    const parser = module(nodes, 'parser');
    assert.equal(parser.file, 'parser.rs');
    assert.equal(parser.directory, 'parser');
    assert.equal(parser.style, 'file');
    assert.equal(nodes.filter((node) => node.kind === 'directory').length, 0);

    const util = module(nodes, 'util');
    assert.equal(util.directory, undefined);
  });

  it('represents a 2015 edition module directory by its mod.rs', () => {
    const nodes = build({
      entries: entries('parser/'),
      dirsWithModRs: new Set(['parser'])
    });

    const parser = module(nodes, 'parser');
    assert.equal(parser.style, 'mod-rs');
    assert.equal(parser.file, 'parser/mod.rs');
    assert.equal(parser.directory, 'parser');
  });

  it('keeps a plain directory plain when no module file backs it', () => {
    const nodes = build({ entries: entries('assets/', 'notes.txt') });

    assert.deepEqual(
      nodes.map((node) => `${node.kind}:${node.name}`),
      ['directory:assets', 'file:notes.txt']
    );
  });

  it('hides mod.rs inside its own module directory', () => {
    const listing: BuildInput = { entries: entries('mod.rs', 'lexer.rs'), isModuleDirectory: true };

    assert.deepEqual(
      build(listing).map((node) => node.name),
      ['lexer']
    );
    assert.deepEqual(
      build(listing, { hideModRs: false })
        .map((node) => node.name)
        .sort(),
      ['lexer', 'mod.rs']
    );
  });

  it('nests crate level modules under lib.rs', () => {
    const nodes = build({
      entries: entries('lib.rs', 'parser.rs', 'parser/', 'util.rs', 'Cargo.lock'),
      isCrateRoot: true
    });

    assert.deepEqual(
      nodes.map((node) => `${node.kind}:${node.name}`),
      ['module:lib', 'file:Cargo.lock']
    );

    const lib = module(nodes, 'lib');
    assert.equal(lib.isCrateRoot, true);
    assert.deepEqual(
      lib.nested.map((node) => node.name),
      ['parser', 'util']
    );
  });

  it('leaves main.rs beside lib.rs as its own crate root', () => {
    const nodes = build({ entries: entries('lib.rs', 'main.rs', 'parser.rs'), isCrateRoot: true });

    assert.deepEqual(
      nodes.map((node) => node.name),
      ['lib', 'main']
    );
    assert.deepEqual(
      module(nodes, 'lib').nested.map((node) => node.name),
      ['parser']
    );
  });

  it('nests under main.rs when the crate has no library root', () => {
    const nodes = build({ entries: entries('main.rs', 'parser.rs'), isCrateRoot: true });

    assert.deepEqual(
      module(nodes, 'main').nested.map((node) => node.name),
      ['parser']
    );
  });

  it('keeps lib.rs beside a directory that merely shares its name', () => {
    const nodes = build({
      entries: entries('lib.rs', 'lib/', 'parser.rs', 'parser/', 'util.rs'),
      declaredModules: ['parser', 'util'],
      isCrateRoot: true
    });

    assert.deepEqual(
      nodes.map((node) => `${node.kind}:${node.name}`),
      ['directory:lib', 'module:lib']
    );

    // `src/lib/` is not the crate root's module directory: `mod` in `lib.rs`
    // resolves against `src/`, so the two rows stay independent.
    const lib = module(nodes, 'lib');
    assert.equal(lib.file, 'lib.rs');
    assert.equal(lib.directory, undefined);
    assert.equal(lib.isCrateRoot, true);
    assert.equal(lib.declared, undefined);
    assert.deepEqual(
      lib.nested.map((node) => node.name),
      ['parser', 'util']
    );
  });

  it('keeps main.rs and build.rs beside directories sharing their names', () => {
    const nodes = build({
      entries: entries('main.rs', 'main/', 'build.rs', 'build/'),
      declaredModules: [],
      isCrateRoot: true
    });

    assert.deepEqual(
      nodes.map((node) => `${node.kind}:${node.name}`),
      ['directory:build', 'directory:main', 'module:build', 'module:main']
    );

    for (const name of ['main', 'build']) {
      assert.equal(module(nodes, name).directory, undefined, name);
      assert.equal(module(nodes, name).isCrateRoot, true, name);
    }
  });

  it('still nests a lib/ directory under lib.rs outside a crate root', () => {
    const nodes = build({ entries: entries('lib.rs', 'lib/'), declaredModules: ['lib'] });

    const lib = module(nodes, 'lib');
    assert.equal(lib.directory, 'lib');
    assert.equal(lib.isCrateRoot, false);
    assert.equal(lib.declared, true);
    assert.equal(nodes.filter((node) => node.kind === 'directory').length, 0);
  });

  it('does not nest the crate root when the setting is off', () => {
    const nodes = build(
      { entries: entries('lib.rs', 'parser.rs'), isCrateRoot: true },
      { nestCrateRoot: false }
    );

    assert.deepEqual(nodes.map((node) => node.name).sort(), ['lib', 'parser']);
    assert.deepEqual(module(nodes, 'lib').nested, []);
  });

  it('marks modules the owning file never declares', () => {
    const nodes = build({
      entries: entries('parser.rs', 'orphan.rs'),
      declaredModules: ['parser']
    });

    assert.equal(module(nodes, 'parser').declared, true);
    assert.equal(module(nodes, 'orphan').declared, false);
  });

  it('never marks crate roots as undeclared', () => {
    const nodes = build({
      entries: entries('lib.rs', 'main.rs', 'build.rs'),
      declaredModules: [],
      isCrateRoot: true
    });

    for (const name of ['lib', 'main', 'build']) {
      assert.equal(module(nodes, name).declared, undefined, name);
    }
  });

  it('leaves declaration unknown when the owning file is unknown', () => {
    const nodes = build({ entries: entries('helper.rs') });
    assert.equal(module(nodes, 'helper').declared, undefined);
  });

  it('treats files that are not valid module names as plain files', () => {
    const nodes = build({ entries: entries('my-notes.rs', 'README.md') });

    assert.deepEqual(
      nodes.map((node) => `${node.kind}:${node.name}`).sort(),
      ['file:README.md', 'file:my-notes.rs']
    );
  });

  it('can hide non Rust files', () => {
    const nodes = build({ entries: entries('lib.rs', 'Cargo.toml') }, { showNonRustFiles: false });
    assert.deepEqual(nodes.map((node) => node.name), ['lib']);
  });

  it('sorts modules with children first by default', () => {
    const nodes = build({
      entries: entries('zeta.rs', 'zeta/', 'alpha.rs', 'Cargo.toml', 'beta/')
    });

    assert.deepEqual(
      nodes.map((node) => node.name),
      ['beta', 'zeta', 'alpha', 'Cargo.toml']
    );
  });

  it('sorts alphabetically when asked', () => {
    const nodes = build(
      { entries: entries('zeta.rs', 'zeta/', 'alpha.rs', 'Cargo.toml') },
      { sortOrder: 'alphabetical' }
    );

    assert.deepEqual(
      nodes.map((node) => node.name),
      ['alpha', 'Cargo.toml', 'zeta']
    );
  });

  it('sorts by declaration order when asked', () => {
    const nodes = build(
      {
        entries: entries('alpha.rs', 'beta.rs', 'gamma.rs', 'Cargo.toml'),
        declaredModules: ['gamma', 'alpha']
      },
      { sortOrder: 'declaration' }
    );

    assert.deepEqual(
      nodes.map((node) => node.name),
      ['gamma', 'alpha', 'beta', 'Cargo.toml']
    );
  });
});

describe('moduleRowDescription', () => {
  const row = (overrides: Partial<Parameters<typeof moduleRowDescription>[0]> = {}) =>
    moduleRowDescription({
      fileName: 'parser.rs',
      expandable: true,
      labelIsFileName: false,
      undeclared: false,
      ...overrides
    });

  it('names the file a folder-like row opens', () => {
    assert.equal(row(), 'parser.rs');
  });

  it('names a mod.rs the module directory stands for', () => {
    assert.equal(row({ fileName: 'mod.rs' }), 'mod.rs');
  });

  it('says nothing for a leaf module, which is only ever a file', () => {
    assert.equal(row({ expandable: false }), undefined);
  });

  it('does not repeat a label that already names the file', () => {
    assert.equal(row({ labelIsFileName: true }), undefined);
  });

  it('keeps marking an undeclared leaf module', () => {
    assert.equal(row({ expandable: false, undeclared: true }), 'not declared');
  });

  it('names the file and the missing declaration together', () => {
    assert.equal(row({ undeclared: true }), 'parser.rs \u00b7 not declared');
  });
});
