// Runs the compiled unit tests under out/test.
//
// The test files cannot be handed to `node --test` as a path argument
// directly: Node 20 does not expand globs and rejects `out/test/**/*.test.js`,
// while Node 22 treats every argument as a glob and so rejects the plain
// `out/test` directory. Bare `node --test` works on neither, because Node 22
// also discovers the uncompiled `src/test/*.test.ts` sources. Resolving the
// files here keeps one invocation working across versions and platforms.

const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');

const testDir = path.join(__dirname, '..', 'out', 'test');

function collect(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collect(full));
    } else if (entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }
  return files;
}

let files;
try {
  files = collect(testDir);
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`No compiled tests found in ${testDir}. Run \`npm run compile\` first.`);
    process.exit(1);
  }
  throw err;
}

if (files.length === 0) {
  console.error(`No *.test.js files found in ${testDir}.`);
  process.exit(1);
}

files.sort();

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
