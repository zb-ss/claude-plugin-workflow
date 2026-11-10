'use strict';
/**
 * Reset cache: the contract between the status line (writer) and
 * hooks/lib/rate-limit.js (reader).
 *
 * Shape: {fetched_at: <ms>, data: {five_hour: {utilization, resets_at}, seven_day: {...}}}
 * `resets_at` is always a Date#toISOString() string so the reader's string
 * sort is correct. Windows whose reset is not in the future are never kept.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Must equal the literal in hooks/lib/rate-limit.js readStatuslineCache().
const RESET_CACHE_FILE_NAME = 'claude-statusline-usage.json';
const WINDOW_KEYS = ['five_hour', 'seven_day'];
const EPOCH_MS_THRESHOLD = 1e12;
// Last instant whose ISO string has a four-digit year. Later dates serialise
// as "+YYYYYY-..." which breaks the reader's string sort.
const MAX_ISO_MS = 253402300799999;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveResetCacheFile(env = process.env) {
  return env.CLAUDE_STATUSLINE_CACHE || path.join(os.tmpdir(), RESET_CACHE_FILE_NAME);
}

function dateToIso(date) {
  const time = date.getTime();
  if (Number.isNaN(time) || time < 0 || time > MAX_ISO_MS) return null;
  return date.toISOString();
}

/** Normalise a positive epoch number (seconds or ms) to ISO, or null. */
function epochToIso(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return dateToIso(new Date(value < EPOCH_MS_THRESHOLD ? value * 1000 : value));
}

/** Normalise a date string or epoch number (seconds or ms) to ISO, or null. */
function toIsoString(value) {
  if (typeof value === 'string' && value !== '') return dateToIso(new Date(value));
  return epochToIso(value);
}

// Non-blocking open so a FIFO planted at the path cannot hang the status line.
const OPEN_FLAGS = fs.constants.O_NONBLOCK === undefined
  ? 'r'
  : fs.constants.O_RDONLY | fs.constants.O_NONBLOCK;

/**
 * Parse a JSON file only if it is a regular file owned by the current user.
 * Both caches can live in a shared directory, so anything else (another
 * user's file, a FIFO, a device) is treated as absent. Returns null on any
 * failure.
 */
function readTrustedJson(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, OPEN_FLAGS);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return null;
    return JSON.parse(fs.readFileSync(fd, 'utf-8'));
  } catch {
    // Missing, unreadable or corrupt file is treated as absent
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function readResetCacheData(cache_file) {
  const parsed = readTrustedJson(cache_file);
  return isPlainObject(parsed) && isPlainObject(parsed.data) ? parsed.data : null;
}

function buildResetCacheData(sources, now_ms) {
  const next = {};
  for (const key of WINDOW_KEYS) {
    for (const source of sources) {
      const window = isPlainObject(source) ? source[key] : null;
      if (!isPlainObject(window)) continue;
      const resets_at = toIsoString(window.resets_at);
      if (resets_at === null || new Date(resets_at).getTime() <= now_ms) continue;
      next[key] = Number.isFinite(window.utilization)
        ? { utilization: window.utilization, resets_at }
        : { resets_at };
      break;
    }
  }
  return next;
}

function writeFileAtomically(cache_file, json) {
  // A random suffix: a temp file left behind by a crashed run must not block
  // later writes from a process that reuses the same pid.
  const tmp_file = `${cache_file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let created = false;
  try {
    fs.writeFileSync(tmp_file, json, { flag: 'wx', mode: 0o600 });
    created = true;
    fs.renameSync(tmp_file, cache_file);
  } catch {
    // Cache write failure is non-fatal
    if (created) {
      try { fs.rmSync(tmp_file, { force: true }); } catch { /* best effort */ }
    }
  }
}

function syncResetCache({ cache_file, sources, now_ms }) {
  let next = {};
  try {
    const previous = readResetCacheData(cache_file);
    next = buildResetCacheData([...sources, previous || {}], now_ms);
    const is_unchanged = previous
      ? JSON.stringify(next) === JSON.stringify(previous)
      : Object.keys(next).length === 0;
    if (!is_unchanged) {
      writeFileAtomically(cache_file, JSON.stringify({ fetched_at: now_ms, data: next }));
    }
  } catch {
    // Never throws
  }
  return next;
}

module.exports = {
  RESET_CACHE_FILE_NAME,
  WINDOW_KEYS,
  isPlainObject,
  readTrustedJson,
  resolveResetCacheFile,
  toIsoString,
  epochToIso,
  writeFileAtomically,
  readResetCacheData,
  buildResetCacheData,
  syncResetCache,
};
