#!/usr/bin/env node
'use strict';

/**
 * SessionStart (startup) hook: read-only setup check.
 * Prints one reminder line when the plugin setup is incomplete, otherwise
 * nothing. Writes no file and always exits 0.
 */

try {
  const { checkSetup, formatReminder } = require('../lib/tier-setup');
  const line = formatReminder(checkSetup({ env: process.env }));
  if (line) process.stdout.write(line + '\n');
} catch (_err) {
  // Never block session start; a failed check simply prints nothing.
}

// No process.exit: let pending pipe writes flush so the line is not truncated.
process.exitCode = 0;
