#!/usr/bin/env node
/**
 * CLI: prints the repo-scoped active directory for the current cwd.
 * Used by skill prompts so the agent does not need to derive the path
 * manually. Honors CLAUDE_WORKFLOW_STATE_DIR and CLAUDE_WORKFLOW_REPO_KEY.
 *
 * Usage: node lib/active-dir-cli.js [cwd]
 */
'use strict';

const fs = require('fs');
const { getActiveDir, getActiveBaseDir, getStateDir } = require('./paths');

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));

const cwd = positional[0] || process.cwd();
const activeDir = getActiveDir({ cwd });

// Best-effort mkdir so callers can write into it immediately.
try {
  fs.mkdirSync(activeDir, { recursive: true });
} catch {
  // ignore — caller will surface the failure on the next file op
}

if (flags.has('--all')) {
  process.stdout.write(JSON.stringify({
    state_root: getStateDir(),
    active_base: getActiveBaseDir(),
    active: activeDir,
  }) + '\n');
} else {
  process.stdout.write(activeDir + '\n');
}
