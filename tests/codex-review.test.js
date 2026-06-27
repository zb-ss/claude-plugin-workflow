/**
 * Tests for lib/codex-review.js — the Codex cross-model review lens adapter.
 * Pure logic only (locate via a temp fixture cache; arg builders; Codex→workflow
 * finding mapping). The live Codex run is orchestrated by the supervisor.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cx = require('../lib/codex-review.js');

let cache;

before(() => {
  // Fake codex cache with two versions; only the older has the script populated
  // here AND the newer too — newest with a script must win.
  cache = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cache-'));
  for (const v of ['1.0.4', '1.0.10', '1.0.2']) {
    fs.mkdirSync(path.join(cache, v, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(cache, v, 'scripts', 'codex-companion.mjs'), '// stub');
  }
});
after(() => fs.rmSync(cache, { recursive: true, force: true }));

describe('locateCompanion / version ordering', () => {
  it('picks the newest version (semantic, not lexical: 1.0.10 > 1.0.4)', () => {
    const p = cx.locateCompanion({ cacheDir: cache });
    assert.ok(p.includes(path.join('1.0.10', 'scripts', 'codex-companion.mjs')), p);
  });
  it('compareVersionsDesc orders correctly', () => {
    assert.deepEqual(['1.0.4', '1.0.10', '1.0.2'].sort(cx.compareVersionsDesc), ['1.0.10', '1.0.4', '1.0.2']);
  });
  it('returns null when the cache is missing', () => {
    assert.equal(cx.locateCompanion({ cacheDir: path.join(cache, 'nope') }), null);
    assert.equal(cx.isAvailable({ cacheDir: path.join(cache, 'nope') }), false);
  });
});

describe('arg builders', () => {
  it('review defaults to branch scope + background', () => {
    assert.deepEqual(cx.buildReviewArgs({ base: 'main' }), ['review', '--scope', 'branch', '--base', 'main', '--background']);
  });
  it('foreground review when background:false', () => {
    assert.deepEqual(cx.buildReviewArgs({ background: false }), ['review', '--scope', 'branch']);
  });
  it('status/result args take a job id + --json', () => {
    assert.deepEqual(cx.buildResultArgs('job-7'), ['result', 'job-7', '--json']);
    assert.deepEqual(cx.buildStatusArgs('job-7'), ['status', 'job-7', '--json']);
  });
});

describe('parseReview (Codex → workflow finding shape)', () => {
  const sample = {
    verdict: 'needs-attention',
    summary: 'Two issues found',
    findings: [
      { severity: 'critical', title: 'SQL injection', body: 'concats input', file: 'src/db.js', line_start: 42, line_end: 42, confidence: 0.9, recommendation: 'use params' },
      { severity: 'low', title: 'naming', body: 'snake_case', file: 'src/x.ts', line_start: 7, line_end: 9, confidence: 0.5, recommendation: 'camelCase' },
    ],
  };
  it('maps severity, line_start→line, and tags source=codex', () => {
    const r = cx.parseReview(sample);
    assert.equal(r.verdict, 'needs-attention');
    assert.equal(r.findings.length, 2);
    assert.equal(r.findings[0].severity, 'CRITICAL');
    assert.equal(r.findings[0].line, 42);
    assert.equal(r.findings[0].source, 'codex');
    assert.equal(r.findings[1].severity, 'MINOR'); // low → MINOR
  });
  it('tolerates empty/missing findings', () => {
    assert.deepEqual(cx.parseReview({}).findings, []);
    assert.deepEqual(cx.parseReview(null).findings, []);
  });
  it('toIssueLines renders [ISSUE-N] [codex] lines with location', () => {
    const lines = cx.toIssueLines(cx.parseReview(sample), 5);
    assert.match(lines[0], /^- \[ISSUE-5\] \[CRITICAL\] \[codex\] SQL injection - src\/db\.js:42 - use params$/);
    assert.match(lines[1], /\[ISSUE-6\] \[MINOR\] \[codex\] naming - src\/x\.ts:7/);
  });
});
