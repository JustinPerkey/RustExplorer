#!/usr/bin/env node
// Prepares the CHANGELOG entry and the release notes for a version.
//
//   node scripts/changelog.js <version> [--notes-out <file>]
//
// If CHANGELOG.md already documents <version>, that section is used verbatim and
// the file is left alone. Otherwise a new section is inserted at the top of the
// list, built from the commit subjects since the previous release tag.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

function git(args) {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function previousTag() {
    try {
        return git(['describe', '--tags', '--abbrev=0', '--match', 'v*']);
    } catch {
        return '';
    }
}

function commitSubjects() {
    const tag = previousTag();
    const range = tag ? `${tag}..HEAD` : 'HEAD';
    const log = git(['log', '--no-merges', '--pretty=format:%s', range]);
    const subjects = log ? log.split('\n').map((line) => line.trim()).filter(Boolean) : [];
    // Drop the version bump commits this workflow makes itself.
    return subjects.filter((subject) => !/^(chore: )?release v?\d+\.\d+\.\d+$/i.test(subject));
}

// Returns the body of the "## <version>" section, or null when absent.
function existingSection(changelog, version) {
    const heading = new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?.*$`, 'm');
    const start = changelog.search(heading);
    if (start === -1) {
        return null;
    }
    const afterHeading = changelog.indexOf('\n', start) + 1;
    const next = changelog.slice(afterHeading).search(/^## /m);
    const body = next === -1 ? changelog.slice(afterHeading) : changelog.slice(afterHeading, afterHeading + next);
    return body.trim();
}

function insertSection(changelog, version, body) {
    const section = `## ${version}\n\n${body}\n`;
    const firstEntry = changelog.search(/^## /m);
    if (firstEntry === -1) {
        return `${changelog.replace(/\s*$/, '')}\n\n${section}`;
    }
    return `${changelog.slice(0, firstEntry)}${section}\n${changelog.slice(firstEntry)}`;
}

function main() {
    const [version, ...rest] = process.argv.slice(2);
    if (!version) {
        console.error('usage: node scripts/changelog.js <version> [--notes-out <file>]');
        process.exit(1);
    }

    const notesOutIndex = rest.indexOf('--notes-out');
    const notesOut = notesOutIndex === -1 ? null : rest[notesOutIndex + 1];

    const changelog = fs.readFileSync(changelogPath, 'utf8');
    let notes = existingSection(changelog, version);

    if (notes === null) {
        const subjects = commitSubjects();
        notes = subjects.length
            ? subjects.map((subject) => `- ${subject}`).join('\n')
            : '- Maintenance release.';
        fs.writeFileSync(changelogPath, insertSection(changelog, version, notes));
        console.error(`CHANGELOG.md: added section for ${version}`);
    } else {
        console.error(`CHANGELOG.md: reusing existing section for ${version}`);
    }

    if (notesOut) {
        fs.writeFileSync(notesOut, `${notes}\n`);
    }
    process.stdout.write(`${notes}\n`);
}

main();
