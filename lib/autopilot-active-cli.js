#!/usr/bin/env node
/**
 * CLI: find autopilot-managed in-flight tasks ACROSS ALL repo buckets.
 *
 * The driver (skills/auto) runs from the control plane, not from any one target
 * repo, so it cannot use the cwd-scoped active dir to locate the in-flight task:
 * an autopilot burst's state lives in the TARGET repo's bucket
 * (active/<target-repo-key>/), which varies per task. This scans every bucket
 * under the active base and returns the states stamped with a `queue_issue_number`
 * (the autopilot marker), most-recent first. Manual (non-autopilot) workflows —
 * which have no queue_issue_number — are ignored, so a hand-run workflow in some
 * other repo never confuses the driver. Returns [] when nothing is in flight.
 *
 * Usage: node lib/autopilot-active-cli.js [active_base_dir]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { getActiveBaseDir } = require('./paths');

/**
 * @param {string} [baseDir] active base (defaults to the resolved active root)
 * @returns {Array<{path:string, repo_key:string, state:object}>} newest-first
 */
function findAutopilotStates(baseDir) {
  const base = baseDir || getActiveBaseDir();
  const out = [];

  let subdirs;
  try {
    subdirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory());
  } catch {
    return out; // base missing → nothing in flight
  }

  for (const d of subdirs) {
    const dir = path.join(base, d.name);
    let files;
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.state.json'));
    } catch {
      continue;
    }
    for (const f of files) {
      const p = path.join(dir, f);
      try {
        const state = JSON.parse(fs.readFileSync(p, 'utf8'));
        const issue = state && state.queue_issue_number;
        if (issue !== undefined && issue !== null && issue !== '') {
          out.push({ path: p, repo_key: (state && state.repo_key) || d.name, state });
        }
      } catch {
        // skip unreadable / half-written state files
      }
    }
  }

  out.sort((a, b) =>
    new Date(b.state.updated_at || 0).getTime() - new Date(a.state.updated_at || 0).getTime());
  return out;
}

if (require.main === module) {
  const base = process.argv.slice(2).find(a => !a.startsWith('--'));
  process.stdout.write(JSON.stringify(findAutopilotStates(base), null, 2) + '\n');
}

module.exports = { findAutopilotStates };
