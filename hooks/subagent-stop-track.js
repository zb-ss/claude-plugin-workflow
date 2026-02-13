#!/usr/bin/env node
/**
 * Subagent Stop Track — Phase transition tracking (SubagentStop event)
 *
 * Maps finished agent types to gate names and updates the JSON state.
 * Best-effort verdict detection from the agent transcript path.
 * Resets stop-guard counter when phase progresses.
 *
 * ALWAYS exits 0 — tracking only, never blocks.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  const { getActiveWorkflow, updateState } = require('./lib/state');
  const { getGateForAgent, PHASE_ORDER } = require('./lib/mode-rules');
  const { log } = require('./lib/logger');

  // Read stdin (SubagentStop hook input)
  let input = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) input = JSON.parse(stdin);
  } catch {}

  const agentType = input.agent_type;
  if (!agentType) {
    process.exit(0);
  }

  // Map agent type to gate
  const gateName = getGateForAgent(agentType);
  if (!gateName) {
    log('subagent-stop', `No gate mapping for agent type: ${agentType}`);
    process.exit(0);
  }

  // Get active workflow
  const active = getActiveWorkflow();
  if (!active) {
    process.exit(0);
  }

  // Best-effort verdict detection from transcript
  let verdict = null;
  try {
    const transcriptPath = input.agent_transcript_path;
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      const stat = fs.statSync(transcriptPath);
      // Read last 2KB for verdict keywords
      const readSize = Math.min(stat.size, 2048);
      const fd = fs.openSync(transcriptPath, 'r');
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
      fs.closeSync(fd);

      const tail = buffer.toString('utf8').toUpperCase();
      if (tail.includes('PASS') || tail.includes('APPROVED')) {
        verdict = 'passed';
      } else if (tail.includes('FAIL') || tail.includes('REJECTED')) {
        verdict = 'failed';
      }
    }
  } catch {
    // Verdict detection is best-effort
  }

  // Update state
  const updated = updateState(active.path, (state) => {
    if (!state.gates) state.gates = {};
    if (!state.gates[gateName]) {
      state.gates[gateName] = { status: 'pending', iteration: 0 };
    }

    const gate = state.gates[gateName];

    // Update iteration count
    gate.iteration = (gate.iteration || 0) + 1;

    // Update gate status based on verdict
    if (verdict === 'passed') {
      gate.status = 'passed';

      // Advance phase if appropriate
      if (state.phase) {
        const completed = state.phase.completed || [];
        const remaining = state.phase.remaining || [];

        if (!completed.includes(gateName)) {
          completed.push(gateName);
          state.phase.completed = completed;
        }

        const remainingIdx = remaining.indexOf(gateName);
        if (remainingIdx !== -1) {
          remaining.splice(remainingIdx, 1);
          state.phase.remaining = remaining;
        }

        // Advance current phase to next remaining
        if (remaining.length > 0) {
          state.phase.current = remaining[0];
        } else {
          state.phase.current = 'completed';
        }
      }
    } else if (verdict === 'failed') {
      gate.status = 'failed';
    } else {
      // No clear verdict — mark in_progress if still pending
      if (gate.status === 'pending') {
        gate.status = 'in_progress';
      }
    }

    // Add agent log entry
    if (!state.agent_log) state.agent_log = [];
    state.agent_log.push({
      timestamp: new Date().toISOString(),
      agent_type: agentType,
      gate: gateName,
      verdict: verdict || 'unknown',
      iteration: gate.iteration,
      agent_id: input.agent_id || null,
    });

    return state;
  });

  if (updated && verdict === 'passed') {
    // Reset stop-guard counter on phase progress
    const sessionId = input.session_id || 'unknown';
    const counterFile = path.join(os.tmpdir(), `workflow-stop-${sessionId}.count`);
    try { fs.unlinkSync(counterFile); } catch {}

    log('subagent-stop', `Gate "${gateName}" passed (agent: ${agentType})`);
  } else if (updated) {
    log('subagent-stop', `Gate "${gateName}" updated: verdict=${verdict || 'unknown'} (agent: ${agentType})`);
  }

  process.exit(0);

} catch (err) {
  // Never block — tracking only
  try {
    const { log } = require('./lib/logger');
    log('subagent-stop', `Error (non-blocking): ${err.message}`);
  } catch {}
  process.exit(0);
}
