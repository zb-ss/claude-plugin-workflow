'use strict';
/**
 * Shared helpers for the status line: trusted JSON reads, atomic file writes
 * and window-reset time normalisation. Used by statusline.js and oauth-usage.js.
 */

const fs = require('fs');
const crypto = require('crypto');

const WINDOW_KEYS = ['five_hour', 'seven_day'];
const EPOCH_MS_THRESHOLD = 1e12;
// Last instant whose ISO string has a four-digit year. Later dates serialise
// as "+YYYYYY-..." which breaks string sorting.
const MAX_ISO_MS = 253402300799999;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
 * The file can live in a shared directory, so anything else (another user's
 * file, a FIFO, a device) is treated as absent. Returns null on any failure.
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

function writeFileAtomically(target_file, json) {
  // A random suffix: a temp file left behind by a crashed run must not block
  // later writes from a process that reuses the same pid.
  const tmp_file = `${target_file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let created = false;
  try {
    fs.writeFileSync(tmp_file, json, { flag: 'wx', mode: 0o600 });
    created = true;
    fs.renameSync(tmp_file, target_file);
  } catch {
    // Write failure is non-fatal
    if (created) {
      try { fs.rmSync(tmp_file, { force: true }); } catch { /* best effort */ }
    }
  }
}

module.exports = {
  WINDOW_KEYS,
  isPlainObject,
  readTrustedJson,
  toIsoString,
  epochToIso,
  writeFileAtomically,
};
