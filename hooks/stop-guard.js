#!/usr/bin/env node
/**
 * Stop Guard — THE critical enforcement hook (Stop event)
 *
 * Prevents Claude from stopping a session when mandatory workflow gates
 * are incomplete. Uses a 3-layer infinite loop prevention system:
 *   1. stop_hook_active circuit breaker (checked first)
 *   2. Session counter — max 5 consecutive blocks without phase progress
 *   3. Staleness detection — if updated_at unchanged across 3 invocations
 *
 * Exit 0 = allow stop. JSON { decision: "block", reason } = block stop.
 * On ANY error, exits 0 (never breaks a session).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  const { getWorkflowForSession, allMandatoryGatesPassed, getPendingGates, getNextPhase } = require('./lib/state');
  const { log } = require('./lib/logger');

  // Read stdin (hook input JSON)
  let input = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) input = JSON.parse(stdin);
  } catch {
    // No stdin or invalid JSON — treat as empty
  }

  // Layer 1: Circuit breaker — if stop hook is already active, allow immediately
  if (input.stop_hook_active === true) {
    log('stop-guard', 'Circuit breaker: stop_hook_active=true, allowing stop');
    process.exit(0);
  }

  // Check for active workflow bound to this session
  const sessionId = input.session_id || 'unknown';
  const active = getWorkflowForSession(sessionId);
  if (!active) {
    // No active workflow — invisible, allow stop
    process.exit(0);
  }

  const { state } = active;

  // Check if all mandatory gates passed
  if (allMandatoryGatesPassed(state)) {
    log('stop-guard', `All gates passed for ${state.workflow_id}, allowing stop`);
    process.exit(0);
  }

  // Gates are incomplete — prepare to block, but check safety layers first
  const counterFile = path.join(os.tmpdir(), `workflow-stop-${sessionId}.count`);
  const staleFile = path.join(os.tmpdir(), `workflow-stop-${sessionId}.stale`);

  // Layer 2: Session counter — max 5 consecutive blocks without progress
  let counter = 0;
  try {
    if (fs.existsSync(counterFile)) {
      counter = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10) || 0;
    }
  } catch {}

  if (counter >= 5) {
    log('stop-guard', `Safety valve: ${counter} consecutive blocks, allowing stop`);
    try { fs.unlinkSync(counterFile); } catch {}
    process.exit(0);
  }

  // Layer 3: Staleness detection — if updated_at unchanged across 3 invocations
  const currentUpdatedAt = state.updated_at || '';
  let staleCount = 0;
  try {
    if (fs.existsSync(staleFile)) {
      const staleData = JSON.parse(fs.readFileSync(staleFile, 'utf8'));
      if (staleData.updated_at === currentUpdatedAt) {
        staleCount = (staleData.count || 0) + 1;
      }
      // updated_at changed — reset stale counter
    }
  } catch {}

  if (staleCount >= 3) {
    log('stop-guard', `Staleness detected: updated_at unchanged for ${staleCount} invocations, allowing stop`);
    try { fs.unlinkSync(staleFile); } catch {}
    try { fs.unlinkSync(counterFile); } catch {}
    process.exit(0);
  }

  // Update counters
  try {
    fs.writeFileSync(counterFile, String(counter + 1), 'utf8');
    fs.writeFileSync(staleFile, JSON.stringify({
      updated_at: currentUpdatedAt,
      count: staleCount,
    }), 'utf8');
  } catch {}

  // Block the stop with actionable reason
  const pending = getPendingGates(state);
  const nextPhase = getNextPhase(state);
  const pendingNames = pending.map(g => g.name).join(', ');
  const nextAction = nextPhase
    ? `Next action: advance to ${nextPhase} phase.`
    : 'Check workflow state for next steps.';

  const reason = [
    `Cannot stop. Active workflow "${state.workflow_id}" has incomplete mandatory gates.`,
    `Missing: ${pendingNames}.`,
    nextAction,
    `(Block ${counter + 1}/5 — safety valve at 5)`,
  ].join(' ');

  log('stop-guard', `Blocking stop: ${pendingNames} pending (${counter + 1}/5)`);

  // Output block decision
  const output = JSON.stringify({ decision: 'block', reason });
  process.stdout.write(output);
  process.exit(0);

} catch (err) {
  // Top-level catch: NEVER break a session
  try {
    const { log } = require('./lib/logger');
    log('stop-guard', `Error (allowing stop): ${err.message}`);
  } catch {}
  process.exit(0);
}
