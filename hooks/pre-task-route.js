#!/usr/bin/env node
/**
 * Pre-Task Route — Mode routing enforcement (PreToolUse, matcher: Task)
 *
 * Enforces model constraints based on the active workflow mode.
 * When a Task tool call specifies a model that is forbidden for the
 * current mode, denies the call with an explanation.
 *
 * Deny counter: after 3 denials of the same mode+model combo,
 * allows on the 4th attempt with a warning.
 *
 * Always exits 0. Uses permissionDecision for deny.
 * Invisible when no active workflow exists.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  const { getWorkflowForSession } = require('./lib/state');
  const { isModelForbidden, getPreferredModel } = require('./lib/mode-rules');
  const { log } = require('./lib/logger');

  // Read stdin (PreToolUse hook input)
  let input = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) input = JSON.parse(stdin);
  } catch {}

  // No active workflow — invisible
  const sessionId = input.session_id || 'unknown';
  const active = getWorkflowForSession(sessionId);
  if (!active) {
    process.exit(0);
  }

  const { state } = active;
  const mode = state.mode?.current;
  if (!mode) {
    process.exit(0);
  }

  // Extract model from Task tool_input
  const toolInput = input.tool_input || {};
  const requestedModel = toolInput.model;

  // No model specified — allow (CC uses default)
  if (!requestedModel) {
    process.exit(0);
  }

  // Check if model is forbidden
  if (!isModelForbidden(mode, requestedModel)) {
    process.exit(0);
  }

  // Model is forbidden — check deny counter before blocking
  const counterKey = `${mode}-${requestedModel}`;
  const counterFile = path.join(os.tmpdir(), `workflow-deny-${sessionId}.json`);

  let counters = {};
  try {
    if (fs.existsSync(counterFile)) {
      counters = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    }
  } catch {}

  const denyCount = (counters[counterKey] || 0) + 1;
  counters[counterKey] = denyCount;

  try {
    fs.writeFileSync(counterFile, JSON.stringify(counters), 'utf8');
  } catch {}

  // After 3 denials of same combo, allow on 4th with warning
  if (denyCount > 3) {
    log('pre-task-route', `Override: allowing ${requestedModel} in ${mode} mode after ${denyCount} denials`);
    // Reset counter for this combo
    counters[counterKey] = 0;
    try { fs.writeFileSync(counterFile, JSON.stringify(counters), 'utf8'); } catch {}
    process.exit(0);
  }

  // Deny with actionable reason
  const preferred = getPreferredModel(mode);
  const reason = `Mode "${mode}" forbids model "${requestedModel}". Use "${preferred}" instead. (Denial ${denyCount}/3, override at 4)`;

  log('pre-task-route', `Denied ${requestedModel} in ${mode} mode (${denyCount}/3)`);

  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });

  process.stdout.write(output);
  process.exit(0);

} catch (err) {
  // Never break a tool call
  try {
    const { log } = require('./lib/logger');
    log('pre-task-route', `Error (allowing): ${err.message}`);
  } catch {}
  process.exit(0);
}
