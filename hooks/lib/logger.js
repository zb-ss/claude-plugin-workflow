/**
 * Hook logging utility.
 * Appends timestamped entries to ~/.claude-workflows/hook.log.
 * Never throws — logging is best-effort.
 */

const fs = require('fs');
const path = require('path');
const { getHookLogPath } = require('../../lib/paths');

const LOG_FILE = getHookLogPath();

/**
 * Append a timestamped log entry. Never throws.
 * @param {string} event - Event type (e.g., 'stop-guard', 'session-start')
 * @param {string} message - Human-readable log message
 */
function log(event, message) {
  try {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${event}] ${message}\n`;

    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFileSync(LOG_FILE, entry, 'utf8');
  } catch {
    // Never throw from logging
  }
}

module.exports = { log, LOG_FILE };
