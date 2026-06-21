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
  const {
    findActiveStates,
    findLegacyStates,
    countOtherRepoStates,
    findOrphanedOrgFiles,
    writeSessionMarker,
    cleanupStaleMarkers,
  } = require('./lib/state');
  const { log } = require('./lib/logger');

  // Read stdin (hook input JSON)
  let input = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) input = JSON.parse(stdin);
  } catch {}

  // Write session marker so skills can discover the session_id
  const sessionId = input.session_id;
  if (sessionId) {
    writeSessionMarker(sessionId);
    // Clean up markers older than 24 hours to prevent accumulation
    cleanupStaleMarkers(24 * 60 * 60 * 1000);
  }

  // Scope strictly to the current repo (matched by repo_key). Workflows from
  // other repo buckets are summarized as a count; unscoped legacy files (no
  // repo_key) are surfaced only as a migrate notice — never as resumable work
  // for this repo. This is what stops cross-repo bleed into the session.
  const cwd = (input && input.cwd) || process.cwd();
  const activeStates = findActiveStates({ cwd, scope: 'current' });
  const legacyStates = findLegacyStates();
  const otherRepoCount = countOtherRepoStates({ cwd });
  const orphanedOrgs = findOrphanedOrgFiles({ cwd });

  // Nothing for this repo, no legacy files, no orphans, no other-repo workflows.
  if (
    activeStates.length === 0 &&
    legacyStates.length === 0 &&
    orphanedOrgs.length === 0 &&
    otherRepoCount === 0
  ) {
    process.exit(0);
  }

  const contextParts = [];

  if (activeStates.length > 0) {
    contextParts.push(
      '## Active Workflows',
      '',
      `There are ${activeStates.length} active workflow(s) for this repository. Use \`/workflow:resume [id]\` to continue one, or \`/workflow:start\` to create a new workflow.`,
      '',
    );

    for (const entry of activeStates) {
      const { state } = entry;
      const pendingGates = Object.entries(state.gates || {})
        .filter(([, g]) => g.status !== 'passed' && g.status !== 'skipped')
        .map(([name]) => name);

      contextParts.push(
        `- **${state.workflow_id}** — ${state.workflow?.type || 'unknown'} (${state.mode?.current || '?'})`,
        `  - Phase: ${state.phase?.current || 'unknown'}`,
        `  - Pending Gates: ${pendingGates.length > 0 ? pendingGates.join(', ') : 'none'}`,
        `  - Org File: ${state.org_file}`,
        `  - State File: ${entry.path}`,
      );

      if (state.workflow?.description) {
        contextParts.push(`  - Description: ${state.workflow.description}`);
      }
    }

    log('session-start', `Found ${activeStates.length} active workflow(s) for current repo`);
  }

  if (otherRepoCount > 0) {
    contextParts.push(
      '',
      `_${otherRepoCount} active workflow(s) belong to other repositories on this machine and are hidden from this session. Run \`/workflow:list --all\` to view them, or \`cd\` into the relevant repo._`,
    );
    log('session-start', `${otherRepoCount} workflow(s) hidden (other repos)`);
  }

  // Unscoped legacy workflows (no repo_key) — belong to no repo. Surface as a
  // migrate/archive notice only; never present them as resumable for this repo.
  if (legacyStates.length > 0) {
    contextParts.push(
      '',
      '### Unscoped legacy workflows (not tied to this repo)',
      '',
      `${legacyStates.length} workflow(s) predate repo-scoping and belong to no repository. They are NOT part of this repo's work — do not resume them here. Run \`/workflow:migrate-legacy\` to assign each to its repo (or archive it).`,
    );
    for (const entry of legacyStates) {
      contextParts.push(`- ${entry.state.workflow_id || '(unknown)'} — ${entry.path}`);
    }
    log('session-start', `${legacyStates.length} unscoped legacy workflow(s) flagged for migration`);
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
