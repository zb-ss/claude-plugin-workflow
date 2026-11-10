#!/usr/bin/env node
/**
 * Workflow plugin status line script
 *
 * Displays usage limits (5h session, 7d weekly), context usage and session
 * cost in Claude Code's status line bar.
 *
 * Stdin-only by default: no credentials are read and no network call is made.
 * Everything shown comes from the JSON Claude Code pipes to stdin. The opt-in
 * extra-usage segment is documented in docs/status-line.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getTranslateDir, getStateDir } = require('../lib/paths');
const {
  WINDOW_KEYS, isPlainObject, resolveResetCacheFile, syncResetCache, toIsoString, epochToIso,
} = require('./reset-cache');

const SETTINGS_FILE_NAME = 'statusline.json';
const EXTRA_USAGE_SETTING_KEY = 'extra_usage';
const BAR_WIDTH = 10;
const TRANSLATE_BAR_WIDTH = 8;
const WINDOW_LABELS = { five_hour: '5h', seven_day: '7d' };

// --- ANSI helpers ---
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';

// --- Formatting helpers ---
function progressBar(pct, width) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar_char = '█'; // Full block
  const empty_char = '░'; // Light shade

  let color;
  if (pct >= 90) color = RED;
  else if (pct >= 70) color = YELLOW;
  else color = GREEN;

  return `${color}${bar_char.repeat(filled)}${DIM}${empty_char.repeat(empty)}${RESET}`;
}

function formatPct(pct) {
  const rounded = Math.round(pct);
  let color;
  if (rounded >= 90) color = RED;
  else if (rounded >= 70) color = YELLOW;
  else color = GREEN;
  return `${color}${String(rounded).padStart(3)}%${RESET}`;
}

function formatResetTime(iso_string, now_ms = Date.now()) {
  if (!iso_string) return '';
  try {
    const reset = new Date(iso_string);
    const diff_ms = reset - now_ms;
    if (diff_ms <= 0) return 'now';

    const hours = Math.floor(diff_ms / 3_600_000);
    const mins = Math.floor((diff_ms % 3_600_000) / 60_000);

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d`;
    }
    if (hours > 0) return `${hours}h${mins}m`;
    return `${mins}m`;
  } catch {
    return '';
  }
}

function formatCost(cost_usd) {
  if (cost_usd == null) return '';
  if (cost_usd < 0.01) return '$0.00';
  if (cost_usd < 1) return `$${cost_usd.toFixed(2)}`;
  return `$${cost_usd.toFixed(2)}`;
}

// --- Translate workflow progress ---
function getTranslateProgress(sessionId, cwd) {
  const TRANSLATE_DIR = getTranslateDir();
  try {
    if (!fs.existsSync(TRANSLATE_DIR)) return null;

    // Try session-scoped binding first
    let targetWorkflowId = null;
    if (sessionId) {
      const bindingPath = path.join(os.tmpdir(), `translate-binding-${sessionId}.json`);
      try {
        if (fs.existsSync(bindingPath)) {
          const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8'));
          if (binding.workflow_id) targetWorkflowId = binding.workflow_id;
        }
      } catch {}
    }

    // If no binding, find most recently updated non-complete workflow matching this cwd
    if (!targetWorkflowId) {
      let latest = null;
      let latestTime = 0;
      const dirs = fs.readdirSync(TRANSLATE_DIR).filter(d => d.includes('-translate-'));
      for (const dir of dirs) {
        const sp = path.join(TRANSLATE_DIR, dir, 'workflow-state.json');
        try {
          if (!fs.existsSync(sp)) continue;
          const s = JSON.parse(fs.readFileSync(sp, 'utf-8'));
          if (s.status === 'complete') continue;
          // Only show workflows whose component is under the current working directory
          if (cwd && s.componentPath && !s.componentPath.startsWith(cwd)) continue;
          const t = new Date(s.updated || 0).getTime();
          if (t > latestTime) { latestTime = t; latest = dir; }
        } catch {}
      }
      targetWorkflowId = latest;
    }

    if (!targetWorkflowId) return null;

    const statePath = path.join(TRANSLATE_DIR, targetWorkflowId, 'workflow-state.json');
    if (!fs.existsSync(statePath)) return null;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

    // Final cwd check for session-bound workflows too
    if (cwd && state.componentPath && !state.componentPath.startsWith(cwd)) return null;
    if (state.status === 'complete') return null;

    const views = state.views || [];
    const done = views.filter(v => v.status === 'done').length;
    const processing = views.filter(v => v.status === 'processing' || v.status === 'review').length;
    const error = views.filter(v => v.status === 'error').length;
    const total = views.length;
    const component = state.componentName || '?';
    const phase = state.status || 'processing';

    // Progress includes done + half-credit for in-progress views (so bar moves during execution)
    const effectiveProgress = done + (processing * 0.5);
    const pct = total > 0 ? Math.round((effectiveProgress / total) * 100) : 0;

    // Check staleness
    const age = Date.now() - new Date(state.updated || 0).getTime();
    const stale = age > 5 * 60 * 1000; // 5 min

    return { component, phase, done, processing, error, total, pct, stale };
  } catch {
    return null;
  }
}

// --- Input helpers ---
function readStdinText() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// 'x'.repeat(negative) throws, so bar arguments must be clamped.
function clampPct(value) {
  return Math.min(100, Math.max(0, value));
}

function parseSession(stdin_text) {
  const text = typeof stdin_text === 'string' ? stdin_text.trim() : '';
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function windowsFromStdin(session) {
  const windows = {};
  const rate_limits = session.rate_limits;
  if (!isPlainObject(rate_limits)) return windows;
  for (const key of WINDOW_KEYS) {
    const raw = rate_limits[key];
    if (!isPlainObject(raw)) continue;
    const utilization = isFiniteNumber(raw.used_percentage) ? raw.used_percentage : null;
    const resets_at = epochToIso(raw.resets_at);
    if (utilization === null && resets_at === null) continue;
    windows[key] = { utilization, resets_at };
  }
  return windows;
}

// --- Segment builders (each returns a string or null) ---
function renderWindowSegment(label, window, now_ms) {
  if (!window || window.utilization === null) return null;
  const pct = window.utilization;
  const reset = formatResetTime(window.resets_at, now_ms);
  const reset_str = reset ? ` ${DIM}${reset}${RESET}` : '';
  return `${DIM}${label}${RESET} ${progressBar(clampPct(pct), BAR_WIDTH)} ${formatPct(pct)}${reset_str}`;
}

function renderContextSegment(session) {
  const ctx = session.context_window;
  if (!isPlainObject(ctx) || !isFiniteNumber(ctx.used_percentage)) return null;
  const pct = Math.round(ctx.used_percentage);
  return `${DIM}ctx${RESET} ${progressBar(clampPct(pct), BAR_WIDTH)} ${formatPct(pct)}`;
}

function renderCostSegment(session) {
  const cost = session.cost;
  if (!isPlainObject(cost) || !isFiniteNumber(cost.total_cost_usd)) return null;
  const cost_str = formatCost(cost.total_cost_usd);
  return cost_str ? `${CYAN}${cost_str}${RESET}` : null;
}

function renderTranslateSegment(session) {
  const session_id = typeof session.session_id === 'string' ? session.session_id : undefined;
  const cwd = typeof session.cwd === 'string' ? session.cwd : undefined;
  const tx = getTranslateProgress(session_id, cwd);
  if (!tx) return null;
  const bar = progressBar(tx.pct, TRANSLATE_BAR_WIDTH);
  const staleTag = tx.stale ? ` ${RED}STALE${RESET}` : '';

  // Show phase-appropriate status
  let detail = '';
  if (tx.phase === 'browser_verification') {
    detail = `${YELLOW}browser${RESET}`;
  } else if (tx.phase === 'verification') {
    detail = `${YELLOW}verify${RESET}`;
  } else if (tx.processing > 0) {
    detail = `${GREEN}${tx.done}done ${tx.processing}run${RESET}`;
  } else {
    detail = `${tx.done}/${tx.total}`;
  }

  return `${DIM}i18n${RESET} ${CYAN}${tx.component}${RESET} ${bar} ${detail}${staleTag}`;
}

function renderModelSegment(session) {
  const model = session.model;
  if (!isPlainObject(model)) return null;
  if (typeof model.display_name !== 'string' || model.display_name === '') return null;
  return `${BOLD}${WHITE}${model.display_name}${RESET}`;
}

// One bad segment must not blank the whole line.
function safeSegment(build) {
  try {
    return build();
  } catch {
    return null;
  }
}

function buildParts(session, display_windows, usage, now_ms) {
  return [
    () => renderModelSegment(session),
    () => renderWindowSegment(WINDOW_LABELS.five_hour, display_windows.five_hour, now_ms),
    () => renderWindowSegment(WINDOW_LABELS.seven_day, display_windows.seven_day, now_ms),
    () => renderExtraUsageSegment(usage && usage.extra_usage),
    () => renderContextSegment(session),
    () => renderCostSegment(session),
    () => renderTranslateSegment(session),
  ].map(safeSegment).filter((part) => part !== null);
}

// --- Opt-in extra usage (the only path that may touch credentials/network) ---
function isExtraUsageEnabled(settings_file) {
  try {
    const settings = JSON.parse(fs.readFileSync(settings_file, 'utf-8'));
    return isPlainObject(settings) && settings[EXTRA_USAGE_SETTING_KEY] === true;
  } catch {
    return false;
  }
}

async function loadOptInUsage({ settings_file, fetch_usage, now_ms }) {
  if (!isExtraUsageEnabled(settings_file)) return null;
  try {
    const lookup_usage = fetch_usage || require('./oauth-usage').fetchUsage;
    const usage = await lookup_usage({ now_ms });
    return isPlainObject(usage) ? usage : null;
  } catch {
    return null;
  }
}

function windowsFromUsage(usage) {
  const windows = {};
  if (!isPlainObject(usage)) return windows;
  for (const key of WINDOW_KEYS) {
    const raw = usage[key];
    if (!isPlainObject(raw)) continue;
    windows[key] = {
      utilization: isFiniteNumber(raw.utilization) ? raw.utilization : null,
      resets_at: toIsoString(raw.resets_at),
    };
  }
  return windows;
}

function renderExtraUsageSegment(extra_usage) {
  if (!isPlainObject(extra_usage) || extra_usage.is_enabled !== true) return null;
  if (!isFiniteNumber(extra_usage.used_credits) || !isFiniteNumber(extra_usage.monthly_limit)) return null;
  const pct = isFiniteNumber(extra_usage.utilization) ? extra_usage.utilization : 0;
  const used = (extra_usage.used_credits / 100).toFixed(2);
  const limit = (extra_usage.monthly_limit / 100).toFixed(2);
  return `${DIM}+${RESET} ${formatPct(pct)} ${CYAN}$${used}${DIM}/$${limit}${RESET}`;
}

function pickDisplayWindow(stdin_window, fetched_window, now_ms) {
  if (stdin_window && stdin_window.utilization !== null) return stdin_window;
  if (!fetched_window || fetched_window.utilization === null) return null;
  const reset_ms = fetched_window.resets_at === null ? null : Date.parse(fetched_window.resets_at);
  return reset_ms === null || reset_ms > now_ms ? fetched_window : null;
}

// --- Orchestration ---
async function run(options = {}) {
  const stdin_text = options.stdin_text || '';
  const now_ms = options.now_ms === undefined ? Date.now() : options.now_ms;
  const cache_file = options.reset_cache_file || resolveResetCacheFile();
  const settings_file = options.settings_file || path.join(getStateDir(), SETTINGS_FILE_NAME);

  const session = parseSession(stdin_text);
  const stdin_windows = windowsFromStdin(session);
  const usage = await loadOptInUsage({
    settings_file,
    fetch_usage: options.fetch_usage,
    now_ms,
  });
  const fetched_windows = windowsFromUsage(usage);
  const display_windows = {};
  for (const key of WINDOW_KEYS) {
    const window = pickDisplayWindow(stdin_windows[key], fetched_windows[key], now_ms);
    if (window) display_windows[key] = window;
  }

  try {
    syncResetCache({ cache_file, sources: [stdin_windows, fetched_windows], now_ms });
  } catch {
    // Cache problems never change the rendered line
  }

  return buildParts(session, display_windows, usage, now_ms).join(` ${DIM}│${RESET} `);
}

async function main() {
  const line = await run({ stdin_text: readStdinText() });
  if (line) console.log(line);
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}

module.exports = {
  run,
  parseSession,
  windowsFromStdin,
  windowsFromUsage,
  isExtraUsageEnabled,
  loadOptInUsage,
  renderExtraUsageSegment,
  formatResetTime,
  progressBar,
  formatPct,
  formatCost,
};
