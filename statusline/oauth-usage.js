/**
 * Opt-in extra usage lookup for the status line.
 *
 * Loaded lazily by statusline.js only when `<state dir>/statusline.json` has
 * `extra_usage: true`. It is never required on the default path. It reads the
 * local Claude credentials and calls an undocumented endpoint.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getStateDir } = require('../lib/paths');
const { isPlainObject, readTrustedJson, writeFileAtomically } = require('./reset-cache');

// Existing debt carried over from the original script: an undocumented
// endpoint and beta header that may change. These belong in configuration;
// keep them here only and do not copy them elsewhere.
const OAUTH_USAGE = Object.freeze({
  api_url: 'https://api.anthropic.com/api/oauth/usage',
  beta_header: 'oauth-2025-04-20',
  cache_ttl_ms: 60_000,
  failure_cache_ttl_ms: 30_000,
  request_timeout_ms: 5000,
  keychain_timeout_ms: 3000,
  keychain_service: 'Claude Code-credentials',
  credentials_path_segments: ['.claude', '.credentials.json'],
  cache_file_name: 'claude-statusline-oauth-usage.json',
});

const USAGE_FIELDS = ['five_hour', 'seven_day', 'extra_usage'];

function tokenFromCredentials(data) {
  const token = isPlainObject(data) && isPlainObject(data.claudeAiOauth)
    ? data.claudeAiOauth.accessToken
    : null;
  return typeof token === 'string' && token !== '' ? token : null;
}

// Lookup order: credentials file, then the macOS keychain. Never logs the token.
function getAccessToken({ home_dir = os.homedir(), platform = process.platform, exec_sync = execSync } = {}) {
  try {
    const cred_path = path.join(home_dir, ...OAUTH_USAGE.credentials_path_segments);
    const token = tokenFromCredentials(JSON.parse(fs.readFileSync(cred_path, 'utf-8')));
    if (token) return token;
  } catch {
    // Continue to next method
  }

  if (platform === 'darwin') {
    try {
      const raw = exec_sync(
        `security find-generic-password -s "${OAUTH_USAGE.keychain_service}" -w`,
        { encoding: 'utf-8', timeout: OAUTH_USAGE.keychain_timeout_ms, stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      const token = tokenFromCredentials(JSON.parse(raw));
      if (token) return token;
    } catch {
      // Keychain not available
    }
  }

  return null;
}

// Per-user state dir, not the shared temp dir: the cache is trusted on read.
function resolveFetchCacheFile() {
  return path.join(getStateDir(), OAUTH_USAGE.cache_file_name);
}

// Accepts only a regular file owned by the current user, so another local user
// cannot plant a cache entry. A failed lookup is stored as { failed: true }.
function readFetchCache(cache_file) {
  const cached = readTrustedJson(cache_file);
  if (!isPlainObject(cached) || !Number.isFinite(cached.fetched_at)) return null;
  if (cached.failed === true) return { fetched_at: cached.fetched_at, failed: true, data: null };
  if (!isPlainObject(cached.data)) return null;
  return { fetched_at: cached.fetched_at, failed: false, data: cached.data };
}

function writeFetchCache(cache_file, entry) {
  try {
    fs.mkdirSync(path.dirname(cache_file), { recursive: true, mode: 0o700 });
    writeFileAtomically(cache_file, JSON.stringify(entry));
  } catch {
    // Cache write failure is non-fatal
  }
}

// Keep only what the status line uses, never the raw body or the token.
function pickUsageFields(body) {
  const picked = {};
  for (const key of USAGE_FIELDS) {
    if (isPlainObject(body[key])) picked[key] = body[key];
  }
  return picked;
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
      timeout: OAUTH_USAGE.request_timeout_ms,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
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

async function requestUsage(token, fetch_impl, http_get) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'anthropic-beta': OAUTH_USAGE.beta_header,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (typeof fetch_impl !== 'function') {
    return { ok: true, body: await http_get(OAUTH_USAGE.api_url, headers) };
  }
  const response = await fetch_impl(OAUTH_USAGE.api_url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(OAUTH_USAGE.request_timeout_ms),
  });
  if (!response.ok) return { ok: false, body: null };
  return { ok: true, body: await response.json() };
}

async function fetchUsage(options = {}) {
  const {
    cache_file = resolveFetchCacheFile(),
    now_ms = Date.now(),
    home_dir,
    platform,
    exec_sync,
    fetch_impl = globalThis.fetch,
    http_get = httpGet,
  } = options;

  const cached = readFetchCache(cache_file);
  if (cached) {
    const age_ms = now_ms - cached.fetched_at;
    const ttl_ms = cached.failed ? OAUTH_USAGE.failure_cache_ttl_ms : OAUTH_USAGE.cache_ttl_ms;
    // A negative age (clock step, forged file) counts as expired.
    if (age_ms >= 0 && age_ms < ttl_ms) return cached.data;
  }

  const data = await lookupUsage({ home_dir, platform, exec_sync, fetch_impl, http_get });
  writeFetchCache(cache_file, data
    ? { fetched_at: now_ms, data }
    : { fetched_at: now_ms, failed: true });
  return data;
}

// Any failure returns null so the caller shows the same line as with the switch off.
async function lookupUsage({ home_dir, platform, exec_sync, fetch_impl, http_get }) {
  const token = getAccessToken({ home_dir, platform, exec_sync });
  if (!token) return null;
  try {
    const { ok, body } = await requestUsage(token, fetch_impl, http_get);
    return ok && isPlainObject(body) ? pickUsageFields(body) : null;
  } catch {
    return null;
  }
}

module.exports = { OAUTH_USAGE, getAccessToken, resolveFetchCacheFile, fetchUsage };
