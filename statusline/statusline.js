#!/usr/bin/env node
/**
 * Workflow plugin status line script
 *
 * Displays usage limits (5h session, 7d weekly) and session cost
 * in Claude Code's status line bar.
 *
 * Data sources:
 * - Usage limits: Anthropic OAuth usage API (cached, refreshed every 60s)
 * - Session info: JSON provided via stdin by Claude Code
 *
 * Credential lookup order:
 * 1. ~/.claude/.credentials.json (plain file - Linux/headless)
 * 2. macOS Keychain via `security` command
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getTranslateDir } = require('../lib/paths');

// --- Configuration ---
const CACHE_TTL_MS = 60_000;
const CACHE_FILE = path.join(os.tmpdir(), 'claude-statusline-usage.json');
const API_URL = 'https://api.anthropic.com/api/oauth/usage';

// --- ANSI helpers ---
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';

// --- Read stdin (session JSON from Claude Code) ---
function readStdin() {
  try {
    const input = fs.readFileSync(0, 'utf-8').trim();
    return input ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}

// --- Credential retrieval ---
function getAccessToken() {
  // 1. Plain file (Linux / headless fallback)
  const credential_paths = [
    path.join(os.homedir(), '.claude', '.credentials.json'),
  ];

  for (const cred_path of credential_paths) {
    try {
      const data = JSON.parse(fs.readFileSync(cred_path, 'utf-8'));
      if (data.claudeAiOauth?.accessToken) {
        return data.claudeAiOauth.accessToken;
      }
    } catch {
      // Continue to next method
    }
  }

  // 2. macOS Keychain
  if (process.platform === 'darwin') {
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w',
        { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      const data = JSON.parse(raw);
      if (data.claudeAiOauth?.accessToken) {
        return data.claudeAiOauth.accessToken;
      }
    } catch {
      // Keychain not available
    }
  }

  return null;
}

// --- Cached API fetch ---
function getCachedUsage() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const cached = JSON.parse(raw);
    if (Date.now() - cached.fetched_at < CACHE_TTL_MS) {
      return cached.data;
    }
  } catch {
    // No valid cache
  }
  return null;
}

function writeCacheUsage(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ fetched_at: Date.now(), data }));
  } catch {
    // Cache write failure is non-fatal
  }
}

function httpGet(url, headers) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'GET',
      headers,
      timeout: 5000,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function fetchUsage(token) {
  // Check cache first
  const cached = getCachedUsage();
  if (cached) return cached;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    // Use native fetch (Node 18+) with fallback to https module
    let data;
    if (typeof globalThis.fetch === 'function') {
      const response = await fetch(API_URL, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      data = await response.json();
    } else {
      data = await httpGet(API_URL, headers);
    }

    writeCacheUsage(data);
    return data;
  } catch {
    // Return stale cache if available
    try {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(raw).data;
    } catch {
      return null;
    }
  }
}

// --- Formatting helpers ---
function progressBar(pct, width) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar_char = '\u2588'; // Full block
  const empty_char = '\u2591'; // Light shade

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

function formatResetTime(iso_string) {
  if (!iso_string) return '';
  try {
    const reset = new Date(iso_string);
    const now = new Date();
    const diff_ms = reset - now;
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

// --- Main ---
async function main() {
  const session = readStdin();
  const token = getAccessToken();

  const parts = [];
  const BAR_WIDTH = 10;

  // Usage limits (from API)
  if (token) {
    const usage = await fetchUsage(token);
    if (usage) {
      // 5-hour session
      if (usage.five_hour) {
        const pct = usage.five_hour.utilization || 0;
        const reset = formatResetTime(usage.five_hour.resets_at);
        const reset_str = reset ? ` ${DIM}${reset}${RESET}` : '';
        parts.push(`${DIM}5h${RESET} ${progressBar(pct, BAR_WIDTH)} ${formatPct(pct)}${reset_str}`);
      }

      // 7-day all models
      if (usage.seven_day) {
        const pct = usage.seven_day.utilization || 0;
        const reset = formatResetTime(usage.seven_day.resets_at);
        const reset_str = reset ? ` ${DIM}${reset}${RESET}` : '';
        parts.push(`${DIM}7d${RESET} ${progressBar(pct, BAR_WIDTH)} ${formatPct(pct)}${reset_str}`);
      }

      // Extra usage (only for OAuth users with extra usage enabled)
      if (usage.extra_usage?.is_enabled) {
        const pct = usage.extra_usage.utilization || 0;
        const used = (usage.extra_usage.used_credits / 100).toFixed(2);
        const limit = (usage.extra_usage.monthly_limit / 100).toFixed(2);
        parts.push(`${DIM}+${RESET} ${formatPct(pct)} ${CYAN}$${used}${DIM}/$${limit}${RESET}`);
      }
    }
  }

  // Context window (from stdin JSON)
  const ctx = session.context_window;
  if (ctx && ctx.used_percentage != null) {
    const pct = Math.round(ctx.used_percentage);
    parts.push(`${DIM}ctx${RESET} ${progressBar(pct, BAR_WIDTH)} ${formatPct(pct)}`);
  }

  // Session cost (from stdin JSON)
  const cost = session.cost;
  if (cost && cost.total_cost_usd != null) {
    const cost_str = formatCost(cost.total_cost_usd);
    if (cost_str) {
      parts.push(`${CYAN}${cost_str}${RESET}`);
    }
  }

  // Translate workflow progress
  const tx = getTranslateProgress(session.session_id, session.cwd);
  if (tx) {
    const bar = progressBar(tx.pct, 8);
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

    parts.push(`${DIM}i18n${RESET} ${CYAN}${tx.component}${RESET} ${bar} ${detail}${staleTag}`);
  }

  // Model name (from stdin JSON)
  if (session.model?.display_name) {
    parts.unshift(`${BOLD}${WHITE}${session.model.display_name}${RESET}`);
  }

  if (parts.length > 0) {
    console.log(parts.join(` ${DIM}\u2502${RESET} `));
  }
}

main().catch(() => process.exit(0));
