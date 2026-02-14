#!/usr/bin/env node
/**
 * Session Start — Workflow auto-resume hook (SessionStart event)
 * Matcher: startup|resume
 *
 * Scans for active .state.json files and injects workflow context
 * into the session via additionalContext. Reports orphaned org files.
 *
 * Always exits 0 — never blocks session startup.
 */

const fs = require('fs');

try {
  const { findActiveStates, findOrphanedOrgFiles } = require('./lib/state');
  const { log } = require('./lib/logger');

  // Read stdin (hook input JSON)
  let input = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) input = JSON.parse(stdin);
  } catch {}

  const activeStates = findActiveStates();
  const orphanedOrgs = findOrphanedOrgFiles();

  // No active workflows and no orphans — exit silently
  if (activeStates.length === 0 && orphanedOrgs.length === 0) {
    process.exit(0);
  }

  const contextParts = [];

  if (activeStates.length > 0) {
    const primary = activeStates[0];
    const { state } = primary;

    // Build pending gates list
    const pendingGates = Object.entries(state.gates || {})
      .filter(([, g]) => g.status !== 'passed' && g.status !== 'skipped')
      .map(([name]) => name);

    contextParts.push(
      '## Active Workflow Detected',
      '',
      `You are resuming an active workflow. Read the org file and continue from the current phase.`,
      '',
      `- **Workflow ID:** ${state.workflow_id}`,
      `- **Type:** ${state.workflow?.type || 'unknown'}`,
      `- **Mode:** ${state.mode?.current || 'unknown'}`,
      `- **Current Phase:** ${state.phase?.current || 'unknown'}`,
      `- **Pending Gates:** ${pendingGates.length > 0 ? pendingGates.join(', ') : 'none'}`,
      `- **Org File:** ${state.org_file}`,
      `- **State File:** ${primary.path}`,
    );

    if (state.workflow?.description) {
      contextParts.push(`- **Description:** ${state.workflow.description}`);
    }

    // Report additional active workflows
    if (activeStates.length > 1) {
      contextParts.push('', '### Other Active Workflows');
      for (let i = 1; i < activeStates.length; i++) {
        const other = activeStates[i].state;
        contextParts.push(
          `- ${other.workflow_id} (${other.workflow?.type || '?'}, phase: ${other.phase?.current || '?'})`
        );
      }
    }

    log('session-start', `Resuming workflow ${state.workflow_id} (phase: ${state.phase?.current})`);
  }

  // Report orphaned org files
  if (orphanedOrgs.length > 0) {
    contextParts.push(
      '',
      '### Orphaned Workflow Files',
      '',
      'These org files have no corresponding .state.json sidecar. They may need recreation:',
    );
    for (const orgPath of orphanedOrgs) {
      contextParts.push(`- ${orgPath}`);
    }

    log('session-start', `Found ${orphanedOrgs.length} orphaned org files`);
  }

  // Output additionalContext
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: contextParts.join('\n'),
    },
  });

  process.stdout.write(output);
  process.exit(0);

} catch (err) {
  // Never block session startup
  try {
    const { log } = require('./lib/logger');
    log('session-start', `Error (allowing start): ${err.message}`);
  } catch {}
  process.exit(0);
}
