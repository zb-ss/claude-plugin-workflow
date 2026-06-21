#!/usr/bin/env node
/**
 * Shared quota-window / rate-limit handling for workflow supervisors.
 *
 * Detection markers, state-shape helpers, and scheduling primitives that any
 * supervisor (swarm or epic) can call when work is interrupted by a usage limit
 * — a transient API 429 *or* a subscription quota window (the 5-hour or weekly
 * Claude usage limit). The reset instant is read from the statusline cache, so
 * resume is scheduled to the exact reset time (no polling).
 *
 * The shape of `state.phase.rate_limit` is:
 *   {
 *     paused_at:    ISO string when the pause began,
 *     resumes_at:   ISO string when the limit is expected to clear,
 *     cron_job_id:  identifier returned by CronCreate (null until scheduled),
 *     reason:       human-readable why-string,
 *     workflow_phase: phase the supervisor was in when paused (so resume knows
 *                     where to pick up — orthogonal to phase.current, which
 *                     stays where it was)
 *   }
 *
 * No CronCreate call is made from this module — scheduling is the supervisor's
 * job because only the supervisor knows the workflow_id to embed in the resume
 * prompt. This module just builds the prompt and computes the cron expression.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Substrings that, when found in agent output, indicate a rate-limit /
 * quota-exhaustion condition. Case-insensitive match.
 *
 * Source: empirical strings observed from Anthropic, common HTTP gateways, and
 * the Claude Code statusline cache. Add new markers here in a single place
 * rather than scattering them across supervisor prompts.
 */
const RATE_LIMIT_MARKERS = [
  'rate limit',
  'rate-limit',
  'rate_limited',
  '429',
  'too many requests',
  'capacity',
  'overloaded',
  'throttled',
  'quota exceeded',
  'usage limit',
  'usage limit reached',
  'claude usage limit',
  '5-hour limit',
  'weekly limit',
  '7-day limit',
  'session limit',
  'daily limit reached',
  'try again later',
];

/**
 * Detect rate-limit markers in arbitrary text. Returns the first matching
 * marker (lowercased) or null.
 */
function detectRateLimit(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  for (const marker of RATE_LIMIT_MARKERS) {
    if (lower.includes(marker)) return marker;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Statusline cache reader
// ---------------------------------------------------------------------------

/**
 * Read the Claude Code statusline cache file (written by the statusline
 * helper). Returns null on any error so callers can fall back to a default
 * pause duration.
 *
 * Path is configurable via CLAUDE_STATUSLINE_CACHE for tests / non-default
 * installs; default matches the statusline helper.
 */
function readStatuslineCache() {
  const cachePath = process.env.CLAUDE_STATUSLINE_CACHE
    || path.join(os.tmpdir(), 'claude-statusline-usage.json');
  try {
    const content = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Return the soonest reset timestamp from the statusline cache, or null.
 * Picks the minimum of `data.five_hour.resets_at` and `data.seven_day.resets_at`
 * when both are present; otherwise whichever exists.
 */
function getNextResetIso(cache) {
  const c = cache || readStatuslineCache();
  if (!c || !c.data) return null;
  const candidates = [];
  if (c.data.five_hour && c.data.five_hour.resets_at) candidates.push(c.data.five_hour.resets_at);
  if (c.data.seven_day && c.data.seven_day.resets_at) candidates.push(c.data.seven_day.resets_at);
  if (candidates.length === 0) return null;
  candidates.sort();
  return candidates[0];
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

/**
 * Apply a pause to a state object. Mutates and returns it. Never throws.
 *
 * @param {object} state - workflow state object (parsed JSON)
 * @param {object} info
 * @param {string} info.reason - human-readable reason
 * @param {string} [info.resumesAt] - ISO timestamp when pause should clear
 * @param {string} [info.workflowPhase] - phase the supervisor was in when paused
 * @param {string} [info.cronJobId] - cron job id if already scheduled
 * @returns {object} the same state object
 */
function applyRateLimitPause(state, info) {
  if (!state || typeof state !== 'object') return state;
  state.phase = state.phase || {};
  state.phase.rate_limit = {
    paused_at: new Date().toISOString(),
    resumes_at: info && info.resumesAt ? info.resumesAt : null,
    cron_job_id: info && info.cronJobId ? info.cronJobId : null,
    reason: info && info.reason ? String(info.reason) : 'rate limit reached',
    workflow_phase: info && info.workflowPhase
      ? info.workflowPhase
      : (state.phase.current || null),
  };
  return state;
}

/**
 * Clear the rate-limit fields. Mutates and returns the state.
 */
function clearRateLimitPause(state) {
  if (!state || typeof state !== 'object') return state;
  if (state.phase && state.phase.rate_limit) {
    state.phase.rate_limit = {
      paused_at: null,
      resumes_at: null,
      cron_job_id: null,
      reason: null,
      workflow_phase: null,
    };
  }
  return state;
}

/**
 * True if the state has an active rate-limit pause. (paused_at set and
 * resumes_at either null or in the future.)
 */
function isRateLimited(state, now) {
  const rl = state && state.phase && state.phase.rate_limit;
  if (!rl || !rl.paused_at) return false;
  if (!rl.resumes_at) return true;
  const t = (now || new Date()).toISOString();
  return rl.resumes_at > t;
}

// ---------------------------------------------------------------------------
// Cron scheduling primitives (supervisor-side)
// ---------------------------------------------------------------------------

/**
 * Build the resume prompt that the cron job will fire when the limit clears.
 * Kept short so it fits any prompt-length budget.
 */
function buildResumePrompt(workflowId) {
  if (!workflowId) return '/workflow:resume';
  return `/workflow:resume ${workflowId}`;
}

/**
 * Convert an ISO reset timestamp into a one-shot cron expression for CronCreate:
 * "min hour day month *". Defaults to **UTC** — a reset is an absolute instant
 * that must fire at the same moment regardless of the host's local timezone or
 * DST, so the supervisor MUST also schedule the cron in UTC (pass the
 * scheduler's UTC/timezone option). Computing local wall-clock components was a
 * latent DST/TZ misfire. Pass `{ timezone: 'local' }` only if the scheduler is
 * known to interpret the expression in local time. Returns null on bad input.
 */
function buildCronExpression(resumesAtIso, opts) {
  if (!resumesAtIso) return null;
  const tz = (opts && opts.timezone) || 'utc';
  let d;
  try { d = new Date(resumesAtIso); } catch { return null; }
  if (Number.isNaN(d.getTime())) return null;

  // Add a 60s safety buffer so we don't fire one second before the limit clears.
  d = new Date(d.getTime() + 60 * 1000);

  let min, hr, day, mon;
  if (tz === 'utc') {
    min = d.getUTCMinutes();
    hr = d.getUTCHours();
    day = d.getUTCDate();
    mon = d.getUTCMonth() + 1;
  } else {
    min = d.getMinutes();
    hr = d.getHours();
    day = d.getDate();
    mon = d.getMonth() + 1;
  }
  return `${min} ${hr} ${day} ${mon} *`;
}

/**
 * Build a complete user-facing pause report string.
 */
function buildPauseReport(workflowId, resumesAtIso, reason) {
  const lines = [
    'Rate limit reached. Workflow paused.',
  ];
  if (resumesAtIso) {
    const eta = new Date(resumesAtIso);
    if (!Number.isNaN(eta.getTime())) {
      const ms = Math.max(0, eta.getTime() - Date.now());
      const mins = Math.round(ms / 60000);
      const human = mins >= 60
        ? `${Math.floor(mins / 60)}h ${mins % 60}m`
        : `${mins}m`;
      lines.push(`  Resumes at: ${resumesAtIso} (in ${human})`);
    } else {
      lines.push(`  Resumes at: ${resumesAtIso}`);
    }
  }
  if (reason) lines.push(`  Reason: ${reason}`);
  if (workflowId) {
    lines.push(`  Run \`/workflow:resume ${workflowId}\` when you return, or wait for the auto-resume cron.`);
  }
  return lines.join('\n');
}

module.exports = {
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
};
