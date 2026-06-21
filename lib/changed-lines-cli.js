#!/usr/bin/env node
/**
 * CLI: parse a unified diff into added/modified line ranges per file, so the
 * verification gate can require coverage on changed lines and target mutation-
 * lite spot-checks.
 *
 * Usage:
 *   node lib/changed-lines-cli.js --git [<base-ref>]  → git diff → pretty JSON
 *   <diff on stdin> | node lib/changed-lines-cli.js   → parseDiff → pretty JSON
 *
 * Output JSON: [{ file: string, added_ranges: [[start,end],...] }]
 * Exit code:   0 always (extractor, not a gate)
 */
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Pure parser — the testable core.
// ---------------------------------------------------------------------------

/**
 * Collapse a sorted array of integers into [[start,end],...] ranges.
 * Consecutive integers are merged; isolated integers become [n,n].
 */
function collapseRanges(lines) {
  if (lines.length === 0) return [];
  const sorted = lines.slice().sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push([start, end]);
      start = sorted[i];
      end = sorted[i];
    }
  }
  ranges.push([start, end]);
  return ranges;
}

/**
 * Parse a unified diff text into per-file added line ranges.
 *
 * Unified-diff edge cases handled:
 *   - `+++ b/<path>` header strips the leading `b/` prefix.
 *   - `+++ /dev/null` (pure-deletion diffs) is skipped entirely.
 *   - `+++` lines that are the file-header (starting with `+++ `) are not
 *     counted as added content lines — only lines starting with `+` that are
 *     NOT the `+++` header are additions.
 *   - `@@ -a[,b] +c[,d] @@` — only the new-side `+c` offset is used; the
 *     optional `,d` count is ignored (we count actual `+` lines instead).
 *   - When `d` is 0 in `+c,0`, `c` is the line BEFORE the insertion; the
 *     first added line is `c+1`. The standard tracks new-side line numbers
 *     starting at `c` (or `c+1` when d=0); we follow the same: the running
 *     counter starts at the `c` value and is incremented BEFORE counting a
 *     context/added line. Actually the simpler model: `newLine` starts at
 *     `c` (the hunk header value) and is pre-incremented for each non-deletion
 *     line — but for the `+c,0` insertion-only case, `c` already points to the
 *     line before the block, so the first `+` line becomes `c+1`. This is
 *     naturally handled if we increment `newLine` before reading each non-`-`
 *     line, but that breaks normal hunks. Instead: set `newLine = c - 1` and
 *     increment before each non-`-` line (context or addition). This produces
 *     the right result for both normal hunks (c >= 1) and zero-length hunks.
 *   - Files with no added lines are omitted from the output array.
 *
 * @param {string} diffText - Raw unified diff text.
 * @returns {Array<{file: string, added_ranges: number[][]}>}
 */
function parseDiff(diffText) {
  if (!diffText || typeof diffText !== 'string') return [];

  // Regex for the hunk header: @@ -a[,b] +c[,d] @@
  const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

  const fileMap = new Map(); // path → Set of added line numbers
  let currentFile = null;
  let newLine = 0; // tracks new-side line position (0 = not in hunk)

  for (const raw of diffText.split('\n')) {
    // File header: +++ b/<path> or +++ /dev/null
    if (raw.startsWith('+++ ')) {
      const rest = raw.slice(4);
      if (rest === '/dev/null' || rest.startsWith('/dev/null\t')) {
        // Pure deletion — no new file, no added lines possible
        currentFile = null;
      } else {
        // Strip mandatory `b/` prefix from git-format diffs; fall back to
        // the raw path if absent (e.g. plain diff -u output).
        const filePath = rest.startsWith('b/') ? rest.slice(2) : rest;
        // Trim any trailing \r (Windows line endings in diff output)
        currentFile = filePath.replace(/\r$/, '');
        if (!fileMap.has(currentFile)) fileMap.set(currentFile, new Set());
      }
      newLine = 0;
      continue;
    }

    // Hunk header
    if (raw.startsWith('@@ ')) {
      const m = raw.match(HUNK_RE);
      if (m) {
        const c = parseInt(m[1], 10);
        // newLine = c - 1 so that incrementing before each non-deletion line
        // produces c as the first new-side line number (handles both normal
        // and +c,0 insertion-point hunks uniformly).
        newLine = c - 1;
      }
      continue;
    }

    if (!currentFile) continue;

    if (raw.startsWith('--- ') || raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('new file') || raw.startsWith('old file') || raw.startsWith('deleted file') || raw.startsWith('similarity') || raw.startsWith('rename ') || raw.startsWith('Binary ')) {
      // Meta-header lines — do not advance new-side counter
      continue;
    }

    if (raw.startsWith('-')) {
      // Deletion: advances only old-side counter, skip
      continue;
    }

    if (raw.startsWith('+')) {
      // Added line — advance new-side counter then record
      newLine++;
      fileMap.get(currentFile).add(newLine);
      continue;
    }

    // Context line (space-prefixed or empty line within hunk that isn't a
    // header). Advance new-side counter but do not record.
    if (raw.startsWith(' ') || raw === '' || raw === '\\ No newline at end of file') {
      // '\\ No newline' does not represent a real line — skip counter
      if (raw !== '\\ No newline at end of file') newLine++;
    }
  }

  // Build output, omitting files with zero added lines
  const result = [];
  for (const [file, lineSet] of fileMap) {
    if (lineSet.size === 0) continue;
    result.push({ file, added_ranges: collapseRanges([...lineSet]) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Git wrapper
// ---------------------------------------------------------------------------

/**
 * Run `git diff --unified=0 [base]` and return parseDiff of its output.
 * When base is omitted, diffs the staged (cached) changes against HEAD,
 * mirroring the scrub-cli default behaviour.
 *
 * @param {string|undefined} base - Optional base ref (branch, commit, tag).
 * @param {string} [cwd=process.cwd()] - Working directory.
 * @returns {Array<{file: string, added_ranges: number[][]}>}
 */
function changedLines(base, cwd) {
  const git = (args) => {
    try {
      return execFileSync('git', args, {
        encoding: 'utf8',
        cwd: cwd || process.cwd(),
      });
    } catch {
      return '';
    }
  };

  // Canonical convention (matches lib/scrub-cli.js + lib/risk-classify-cli.js):
  // three-dot range = the task's committed changes vs the base branch; `--cached`
  // when no base. All gates classify the SAME diff this way.
  const diffText = base
    ? git(['diff', '--unified=0', `${base}...HEAD`])
    : git(['diff', '--unified=0', '--cached']);

  return parseDiff(diffText);
}

// ---------------------------------------------------------------------------
// Guarded dispatch — no top-level side effects
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);

  let result;
  if (argv[0] === '--git') {
    const base = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
    result = changedLines(base);
  } else {
    // Read diff from stdin
    let stdin = '';
    try { stdin = fs.readFileSync(0, 'utf8'); } catch { stdin = ''; }
    result = parseDiff(stdin);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

module.exports = { parseDiff, changedLines, collapseRanges };
