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

  // Model name (from stdin JSON)
  if (session.model?.display_name) {
    parts.unshift(`${BOLD}${WHITE}${session.model.display_name}${RESET}`);
  }

  if (parts.length > 0) {
    console.log(parts.join(` ${DIM}\u2502${RESET} `));
  }
}

main().catch(() => process.exit(0));
