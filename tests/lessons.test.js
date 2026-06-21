/**
 * Tests for lib/lessons-cli.js — per-repo lessons memory.
 *
 * Uses a temp directory via opts.dir so no real state dir is touched.
 * Tests: append→read round-trip; dedup; category prefix; parseLessons on
 * mixed bullets; read of an unknown repo → ''.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { lessonsPath, read, parseLessons, append } = require('../lib/lessons-cli.js');

// ---------------------------------------------------------------------------
// Shared temp dir
// ---------------------------------------------------------------------------

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-test-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper so every test uses the isolated temp dir.
const opts = () => ({ dir: tmpDir });

// ---------------------------------------------------------------------------
// lessonsPath
// ---------------------------------------------------------------------------

describe('lessonsPath', () => {
  it('returns <dir>/lessons/<repo-key>.md', () => {
    const p = lessonsPath('my-repo', { dir: '/some/state' });
    assert.equal(p, path.join('/some/state', 'lessons', 'my-repo.md'));
  });
});

// ---------------------------------------------------------------------------
// read — unknown repo
// ---------------------------------------------------------------------------

describe('read', () => {
  it('returns empty string for a repo that has no lessons file yet', () => {
    const result = read('unknown-repo-xyz', opts());
    assert.equal(result, '');
  });
});

// ---------------------------------------------------------------------------
// append → read round-trip
// ---------------------------------------------------------------------------

describe('append + read round-trip', () => {
  it('creates the file and stores the lesson as a bullet', () => {
    const repoKey = 'roundtrip-repo';
    const result = append(repoKey, 'Always run migrations in a transaction', opts());

    assert.equal(result.added, true);
    assert.equal(result.path, lessonsPath(repoKey, opts()));

    const contents = read(repoKey, opts());
    assert.ok(contents.includes('- [general] Always run migrations in a transaction'));
  });

  it('appending a second distinct lesson adds a second bullet', () => {
    const repoKey = 'roundtrip-repo-2';
    append(repoKey, 'First lesson', opts());
    append(repoKey, 'Second lesson', opts());

    const lessons = parseLessons(read(repoKey, opts()));
    assert.equal(lessons.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

describe('dedup', () => {
  it('appending the exact same text twice returns added:false on the second call', () => {
    const repoKey = 'dedup-exact';
    const first = append(repoKey, 'Avoid N+1 queries in list views', opts());
    const second = append(repoKey, 'Avoid N+1 queries in list views', opts());

    assert.equal(first.added, true);
    assert.equal(second.added, false);
  });

  it('only one bullet is written after two identical appends', () => {
    const repoKey = 'dedup-single-bullet';
    append(repoKey, 'Use prepared statements', opts());
    append(repoKey, 'Use prepared statements', opts());

    const lessons = parseLessons(read(repoKey, opts()));
    assert.equal(lessons.length, 1);
  });

  it('dedup is case-insensitive and ignores extra whitespace', () => {
    const repoKey = 'dedup-normalize';
    append(repoKey, 'Always validate  input', opts());
    const second = append(repoKey, '  always validate input  ', opts());

    assert.equal(second.added, false);
    const lessons = parseLessons(read(repoKey, opts()));
    assert.equal(lessons.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Category prefix
// ---------------------------------------------------------------------------

describe('category', () => {
  it('stores the category in the bullet prefix', () => {
    const repoKey = 'cat-repo';
    append(repoKey, 'Eager-load relationships', { ...opts(), category: 'perf' });

    const contents = read(repoKey, opts());
    assert.ok(contents.includes('- [perf] Eager-load relationships'));
  });

  it('defaults to "general" when no category is given', () => {
    const repoKey = 'cat-default';
    append(repoKey, 'Some general finding', opts());

    const contents = read(repoKey, opts());
    assert.ok(contents.includes('- [general] Some general finding'));
  });
});

// ---------------------------------------------------------------------------
// parseLessons — mixed bullets
// ---------------------------------------------------------------------------

describe('parseLessons', () => {
  it('parses categorised and plain bullets', () => {
    const md = [
      '# Lessons',
      '',
      '- [perf] Cache expensive queries',
      '- [security] Escape all output',
      '- Plain lesson without category',
      '',
      'Ignore this prose line.',
    ].join('\n');

    const lessons = parseLessons(md);
    assert.equal(lessons.length, 3);

    assert.deepEqual(lessons[0], { category: 'perf', text: 'Cache expensive queries' });
    assert.deepEqual(lessons[1], { category: 'security', text: 'Escape all output' });
    assert.deepEqual(lessons[2], { category: 'general', text: 'Plain lesson without category' });
  });

  it('returns [] for empty/null input', () => {
    assert.deepEqual(parseLessons(''), []);
    assert.deepEqual(parseLessons(null), []);
  });
});
