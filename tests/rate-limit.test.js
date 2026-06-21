/**
 * Tests for hooks/lib/rate-limit.js — shared rate-limit detection, state
 * shape, and scheduling helpers.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  RATE_LIMIT_MARKERS,
  detectRateLimit,
  readStatuslineCache,
  getNextResetIso,
  applyRateLimitPause,
  clearRateLimitPause,
  isRateLimited,
  buildResumePrompt,
  buildCronExpression,
  buildPauseReport,
} = require('../hooks/lib/rate-limit.js');

describe('detectRateLimit()', () => {
  it('returns null for empty / non-string input', () => {
    assert.equal(detectRateLimit(''), null);
    assert.equal(detectRateLimit(null), null);
    assert.equal(detectRateLimit(undefined), null);
    assert.equal(detectRateLimit(42), null);
  });

  it('detects "rate limit" (case-insensitive)', () => {
    assert.equal(detectRateLimit('You hit the Rate Limit, try again.'), 'rate limit');
  });

  it('detects 429 in HTTP-style errors', () => {
    assert.equal(detectRateLimit('HTTP 429 Too Many Requests'), '429');
  });

  it('detects "5-hour limit" message', () => {
    assert.equal(detectRateLimit('You have reached the 5-hour limit'), '5-hour limit');
  });

  it('returns null when no marker is present', () => {
    assert.equal(detectRateLimit('Everything is fine, work continues.'), null);
  });

  it('exposes a non-empty marker list', () => {
    assert.ok(Array.isArray(RATE_LIMIT_MARKERS));
    assert.ok(RATE_LIMIT_MARKERS.length > 5);
    for (const m of RATE_LIMIT_MARKERS) assert.equal(typeof m, 'string');
  });
});

describe('applyRateLimitPause() / clearRateLimitPause() / isRateLimited()', () => {
  it('apply sets all five fields', () => {
    const state = { phase: { current: 'implementation' } };
    applyRateLimitPause(state, {
      reason: 'quota exceeded',
      resumesAt: '2099-01-01T00:00:00Z',
      workflowPhase: 'implementation',
    });
    const rl = state.phase.rate_limit;
    assert.ok(rl.paused_at);
    assert.equal(rl.resumes_at, '2099-01-01T00:00:00Z');
    assert.equal(rl.reason, 'quota exceeded');
    assert.equal(rl.workflow_phase, 'implementation');
    assert.equal(rl.cron_job_id, null);
  });

  it('apply defaults workflow_phase to state.phase.current', () => {
    const state = { phase: { current: 'review' } };
    applyRateLimitPause(state, { reason: 'rate limit' });
    assert.equal(state.phase.rate_limit.workflow_phase, 'review');
  });

  it('apply tolerates missing state.phase', () => {
    const state = {};
    applyRateLimitPause(state, { reason: 'x' });
    assert.ok(state.phase.rate_limit);
    assert.equal(state.phase.rate_limit.reason, 'x');
  });

  it('clear nulls all five fields', () => {
    const state = { phase: { current: 'integration' } };
    applyRateLimitPause(state, { reason: 'x', resumesAt: '2099-01-01T00:00:00Z' });
    clearRateLimitPause(state);
    const rl = state.phase.rate_limit;
    assert.equal(rl.paused_at, null);
    assert.equal(rl.resumes_at, null);
    assert.equal(rl.reason, null);
    assert.equal(rl.workflow_phase, null);
    assert.equal(rl.cron_job_id, null);
  });

  it('isRateLimited is true while resumes_at is in the future', () => {
    const state = {};
    applyRateLimitPause(state, { reason: 'x', resumesAt: '2099-01-01T00:00:00Z' });
    assert.equal(isRateLimited(state), true);
  });

  it('isRateLimited is false once resumes_at has passed', () => {
    const state = {};
    applyRateLimitPause(state, { reason: 'x', resumesAt: '2000-01-01T00:00:00Z' });
    assert.equal(isRateLimited(state), false);
  });

  it('isRateLimited is true when paused_at is set but resumes_at is null', () => {
    const state = {};
    applyRateLimitPause(state, { reason: 'x' });
    assert.equal(isRateLimited(state), true);
  });

  it('isRateLimited is false on an empty state', () => {
    assert.equal(isRateLimited({}), false);
    assert.equal(isRateLimited(null), false);
  });
});

describe('buildResumePrompt()', () => {
  it('embeds the workflow id', () => {
    assert.equal(buildResumePrompt('20260101-abcdef'), '/workflow:resume 20260101-abcdef');
  });
  it('falls back to bare slash command when id is missing', () => {
    assert.equal(buildResumePrompt(null), '/workflow:resume');
    assert.equal(buildResumePrompt(''), '/workflow:resume');
  });
});

describe('buildCronExpression()', () => {
  it('returns null on bad input', () => {
    assert.equal(buildCronExpression(null), null);
    assert.equal(buildCronExpression('not-a-date'), null);
  });

  it('returns a 5-field cron string for a valid ISO timestamp', () => {
    const cron = buildCronExpression('2026-04-28T15:30:00Z', { timezone: 'utc' });
    assert.match(cron, /^\d{1,2} \d{1,2} \d{1,2} \d{1,2} \*$/);
  });

  it('adds a 60s safety buffer (UTC mode)', () => {
    // 15:30:00 + 60s buffer = 15:31
    const cron = buildCronExpression('2026-04-28T15:30:00Z', { timezone: 'utc' });
    const [min, hr, day, mon] = cron.split(' ');
    assert.equal(min, '31');
    assert.equal(hr, '15');
    assert.equal(day, '28');
    assert.equal(mon, '4');
  });

  it('defaults to UTC when no timezone option is given (DST-safe)', () => {
    // No opts → must compute UTC components, identical to explicit utc mode.
    assert.equal(
      buildCronExpression('2026-04-28T15:30:00Z'),
      buildCronExpression('2026-04-28T15:30:00Z', { timezone: 'utc' }),
    );
    assert.equal(buildCronExpression('2026-04-28T15:30:00Z'), '31 15 28 4 *');
  });
});

describe('buildPauseReport()', () => {
  it('includes the workflow id and ETA', () => {
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const report = buildPauseReport('20260101-aaaaaa', future, 'rate limit');
    assert.match(report, /Rate limit reached\. Workflow paused\./);
    assert.match(report, /20260101-aaaaaa/);
    assert.match(report, /Resumes at:/);
  });

  it('handles missing reset time gracefully', () => {
    const report = buildPauseReport('20260101-aaaaaa', null, null);
    assert.match(report, /Rate limit reached\. Workflow paused\./);
    assert.ok(!/Resumes at:/.test(report));
  });
});

describe('readStatuslineCache() / getNextResetIso()', () => {
  let cachePath;
  let saved;
  before(() => {
    saved = process.env.CLAUDE_STATUSLINE_CACHE;
    cachePath = path.join(os.tmpdir(), `wf-rl-cache-${process.pid}.json`);
    process.env.CLAUDE_STATUSLINE_CACHE = cachePath;
  });
  after(() => {
    if (saved === undefined) delete process.env.CLAUDE_STATUSLINE_CACHE;
    else process.env.CLAUDE_STATUSLINE_CACHE = saved;
    try { fs.unlinkSync(cachePath); } catch {}
  });

  it('returns null when cache file is missing', () => {
    try { fs.unlinkSync(cachePath); } catch {}
    assert.equal(readStatuslineCache(), null);
    assert.equal(getNextResetIso(), null);
  });

  it('returns the soonest reset when both windows are present', () => {
    fs.writeFileSync(cachePath, JSON.stringify({
      data: {
        five_hour: { resets_at: '2099-01-01T05:00:00Z' },
        seven_day: { resets_at: '2099-01-08T00:00:00Z' },
      },
    }));
    assert.equal(getNextResetIso(), '2099-01-01T05:00:00Z');
  });

  it('returns the only available window when one is missing', () => {
    fs.writeFileSync(cachePath, JSON.stringify({
      data: { five_hour: { resets_at: '2099-02-01T00:00:00Z' } },
    }));
    assert.equal(getNextResetIso(), '2099-02-01T00:00:00Z');
  });

  it('returns null when neither window has a reset time', () => {
    fs.writeFileSync(cachePath, JSON.stringify({ data: { five_hour: {}, seven_day: {} } }));
    assert.equal(getNextResetIso(), null);
  });
});
