/**
 * Tests for lib/changed-lines-cli.js — pure parseDiff function.
 * All fixtures are literal diff strings; no real git invocations.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDiff, collapseRanges } = require('../lib/changed-lines-cli.js');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function fileResult(results, file) {
  return results.find(r => r.file === file) || null;
}

// ---------------------------------------------------------------------------
// collapseRanges (internal, but exported and critical)
// ---------------------------------------------------------------------------

describe('collapseRanges', () => {
  it('empty array → []', () => {
    assert.deepEqual(collapseRanges([]), []);
  });
  it('single value → [[n,n]]', () => {
    assert.deepEqual(collapseRanges([7]), [[7, 7]]);
  });
  it('consecutive → single range', () => {
    assert.deepEqual(collapseRanges([5, 6, 7]), [[5, 7]]);
  });
  it('gap → two ranges', () => {
    assert.deepEqual(collapseRanges([5, 6, 7, 20]), [[5, 7], [20, 20]]);
  });
  it('unsorted input → sorted output', () => {
    assert.deepEqual(collapseRanges([20, 5, 7, 6]), [[5, 7], [20, 20]]);
  });
});

// ---------------------------------------------------------------------------
// TC1: single file, two disjoint addition blocks
// ---------------------------------------------------------------------------

describe('TC1 — single file, lines 5-7 + standalone line 20', () => {
  // src/a.js with two hunks: adds lines 5-7, then a lone line 20.
  const DIFF = [
    'diff --git a/src/a.js b/src/a.js',
    'index 0000001..0000002 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -4,0 +5,3 @@',
    '+line five',
    '+line six',
    '+line seven',
    '@@ -19,0 +20 @@',
    '+line twenty',
  ].join('\n');

  it('returns exactly one file entry', () => {
    const r = parseDiff(DIFF);
    assert.equal(r.length, 1);
    assert.equal(r[0].file, 'src/a.js');
  });

  it('added_ranges is [[5,7],[20,20]]', () => {
    const r = parseDiff(DIFF);
    assert.deepEqual(r[0].added_ranges, [[5, 7], [20, 20]]);
  });
});

// ---------------------------------------------------------------------------
// TC2: two-file diff — both files with correct ranges
// ---------------------------------------------------------------------------

describe('TC2 — two-file diff', () => {
  const DIFF = [
    'diff --git a/src/alpha.js b/src/alpha.js',
    '--- a/src/alpha.js',
    '+++ b/src/alpha.js',
    '@@ -1,2 +1,4 @@',
    ' unchanged',
    '+added line 2',
    '+added line 3',
    ' unchanged again',
    '+added line 5',
    'diff --git a/src/beta.js b/src/beta.js',
    '--- a/src/beta.js',
    '+++ b/src/beta.js',
    '@@ -10,1 +10,3 @@',
    ' ctx',
    '+beta line 11',
    '+beta line 12',
  ].join('\n');

  it('returns two file entries', () => {
    const r = parseDiff(DIFF);
    assert.equal(r.length, 2);
  });

  it('alpha.js: added_ranges [[2,3],[5,5]]', () => {
    const r = parseDiff(DIFF);
    const entry = fileResult(r, 'src/alpha.js');
    assert.ok(entry, 'src/alpha.js not found');
    assert.deepEqual(entry.added_ranges, [[2, 3], [5, 5]]);
  });

  it('beta.js: added_ranges [[11,12]]', () => {
    const r = parseDiff(DIFF);
    const entry = fileResult(r, 'src/beta.js');
    assert.ok(entry, 'src/beta.js not found');
    assert.deepEqual(entry.added_ranges, [[11, 12]]);
  });
});

// ---------------------------------------------------------------------------
// TC3: pure-deletion hunk — file has no added_ranges (omitted from output)
// ---------------------------------------------------------------------------

describe('TC3 — pure deletion hunk', () => {
  const DIFF = [
    'diff --git a/src/gone.js b/src/gone.js',
    '--- a/src/gone.js',
    '+++ b/src/gone.js',
    '@@ -5,3 +5,0 @@',
    '-deleted line 5',
    '-deleted line 6',
    '-deleted line 7',
  ].join('\n');

  it('omits the file from output (no added lines)', () => {
    const r = parseDiff(DIFF);
    const entry = fileResult(r, 'src/gone.js');
    assert.equal(entry, null, 'pure-deletion file should be absent');
  });

  it('returns empty array when diff has only deletions', () => {
    const r = parseDiff(DIFF);
    assert.equal(r.length, 0);
  });
});

// ---------------------------------------------------------------------------
// TC4: /dev/null → new file add (full range covered)
// ---------------------------------------------------------------------------

describe('TC4 — /dev/null to new file', () => {
  const DIFF = [
    'diff --git a/src/new-file.js b/src/new-file.js',
    'new file mode 100644',
    'index 0000000..abc1234',
    '--- /dev/null',
    '+++ b/src/new-file.js',
    '@@ -0,0 +1,5 @@',
    '+line one',
    '+line two',
    '+line three',
    '+line four',
    '+line five',
  ].join('\n');

  it('captures the new file path (strips b/ prefix)', () => {
    const r = parseDiff(DIFF);
    assert.equal(r.length, 1);
    assert.equal(r[0].file, 'src/new-file.js');
  });

  it('added_ranges covers all 5 lines [[1,5]]', () => {
    const r = parseDiff(DIFF);
    assert.deepEqual(r[0].added_ranges, [[1, 5]]);
  });
});

// ---------------------------------------------------------------------------
// TC5: realistic multi-hunk fixture (mixed adds, deletions, context)
// ---------------------------------------------------------------------------

describe('TC5 — realistic multi-hunk fixture', () => {
  // Simulates a refactor: lines 3 replaced (delete 1, add 2), then a new
  // function inserted at line 30, then a doc-comment block added at 50-52.
  const DIFF = [
    'diff --git a/lib/util.js b/lib/util.js',
    'index aaaaaaa..bbbbbbb 100644',
    '--- a/lib/util.js',
    '+++ b/lib/util.js',
    // Hunk 1: replace line 3 with two lines → new-side lines 3,4
    '@@ -2,3 +2,4 @@',
    ' // unchanged line 2',
    '-old line 3',
    '+new line 3a',
    '+new line 3b',
    ' // unchanged line 5 (was 4)',
    // Hunk 2: insert 3 lines at new position 30 (old +28,0 → +29,3 in new)
    '@@ -26,0 +29,3 @@',
    '+function helperA() {}',
    '+function helperB() {}',
    '+function helperC() {}',
    // Hunk 3: add 3-line doc block starting at new line 50
    '@@ -46,1 +50,4 @@',
    ' // existing comment',
    '+/** @param {string} x */',
    '+/** @returns {boolean} */',
    '+// end doc',
  ].join('\n');

  it('returns exactly one file', () => {
    const r = parseDiff(DIFF);
    assert.equal(r.length, 1);
    assert.equal(r[0].file, 'lib/util.js');
  });

  it('hunk 1: new lines 3–4 captured', () => {
    const r = parseDiff(DIFF);
    const ranges = r[0].added_ranges;
    const has = ranges.some(([s, e]) => s <= 3 && e >= 4);
    assert.ok(has, `Expected range covering 3-4, got ${JSON.stringify(ranges)}`);
  });

  it('hunk 2: three consecutive lines 29–31 captured', () => {
    const r = parseDiff(DIFF);
    const ranges = r[0].added_ranges;
    const has = ranges.some(([s, e]) => s === 29 && e === 31);
    assert.ok(has, `Expected [29,31], got ${JSON.stringify(ranges)}`);
  });

  it('hunk 3: doc lines 51–53 captured', () => {
    const r = parseDiff(DIFF);
    const ranges = r[0].added_ranges;
    const has = ranges.some(([s, e]) => s === 51 && e === 53);
    assert.ok(has, `Expected [51,53], got ${JSON.stringify(ranges)}`);
  });

  it('no spurious lines from deleted or context lines', () => {
    const r = parseDiff(DIFF);
    // All added_ranges values should be in {3,4,29,30,31,51,52,53}
    const expected = new Set([3, 4, 29, 30, 31, 51, 52, 53]);
    for (const [s, e] of r[0].added_ranges) {
      for (let n = s; n <= e; n++) {
        assert.ok(expected.has(n), `Unexpected added line ${n}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('empty string → []', () => {
    assert.deepEqual(parseDiff(''), []);
  });

  it('null/undefined → []', () => {
    assert.deepEqual(parseDiff(null), []);
    assert.deepEqual(parseDiff(undefined), []);
  });

  it('--- /dev/null (pure deletion diff) is skipped entirely', () => {
    const DIFF = [
      'diff --git a/dead.js b/dead.js',
      'deleted file mode 100644',
      '--- a/dead.js',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-line one',
      '-line two',
      '-line three',
    ].join('\n');
    // +++ /dev/null means no new file → nothing to track
    assert.deepEqual(parseDiff(DIFF), []);
  });

  it('diff without b/ prefix in +++ header uses path as-is', () => {
    const DIFF = [
      '--- a/plain.js',
      '+++ plain.js',
      '@@ -0,0 +1 @@',
      '+hello',
    ].join('\n');
    const r = parseDiff(DIFF);
    assert.equal(r.length, 1);
    assert.equal(r[0].file, 'plain.js');
    assert.deepEqual(r[0].added_ranges, [[1, 1]]);
  });
});
