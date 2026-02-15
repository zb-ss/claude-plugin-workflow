#!/usr/bin/env node
/**
 * Task Completed Gate — Workflow completion enforcement (TaskCompleted event)
 *
 * Checks if a completed task looks workflow-related and blocks if
 * mandatory gates are incomplete.
 *
 * Safety: after 3 blocks of the same task, allows with warning.
 *
 * Exit 0 = allow. Exit 2 = block (stderr shown to Claude).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  const { getWorkflowForSession, allMandatoryGatesPassed, getPendingGates } = require('./lib/state');
  const { log } = require('./lib/logger');

  // Read stdin (TaskCompleted hook input)
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

  // Check if the completed task looks workflow-related
  // TaskCompleted input may have task_subject or similar fields
  const taskSubject = (input.task_subject || input.subject || '').toLowerCase();
  const taskDescription = (input.task_description || input.description || '').toLowerCase();
  const combined = taskSubject + ' ' + taskDescription;

  const workflowKeywords = ['workflow', 'complete', 'final', 'finish', 'done', 'wrap up'];
  const isWorkflowRelated = workflowKeywords.some(kw => combined.includes(kw));

  if (!isWorkflowRelated) {
    // Not workflow-related — allow completion
    process.exit(0);
  }

  const { state } = active;

  // Check if all mandatory gates passed
  if (allMandatoryGatesPassed(state)) {
    log('task-completed', `All gates passed for ${state.workflow_id}, allowing completion`);
    process.exit(0);
  }

  // Gates incomplete — check safety counter before blocking
  const taskId = input.task_id || 'unknown';
  const counterFile = path.join(os.tmpdir(), `workflow-complete-${sessionId}-${taskId}.count`);

  let blockCount = 0;
  try {
    if (fs.existsSync(counterFile)) {
      blockCount = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10) || 0;
    }
  } catch {}

  if (blockCount >= 3) {
    log('task-completed', `Safety override: allowing completion after ${blockCount} blocks`);
    try { fs.unlinkSync(counterFile); } catch {}
    process.exit(0);
  }

  // Increment counter
  try {
    fs.writeFileSync(counterFile, String(blockCount + 1), 'utf8');
  } catch {}

  // Block completion
  const pending = getPendingGates(state);
  const pendingNames = pending.map(g => g.name).join(', ');

  const message = `Cannot complete workflow "${state.workflow_id}". Unfinished mandatory gates: ${pendingNames}. (Block ${blockCount + 1}/3)`;

  log('task-completed', `Blocking completion: ${pendingNames} pending (${blockCount + 1}/3)`);

  process.stderr.write(message);
  process.exit(2);

} catch (err) {
  // Never break task completion on error
  try {
    const { log } = require('./lib/logger');
    log('task-completed', `Error (allowing): ${err.message}`);
  } catch {}
  process.exit(0);
}
