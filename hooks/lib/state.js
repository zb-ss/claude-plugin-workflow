#!/usr/bin/env node
/**
 * Shared state management library for workflow hooks.
 * Provides atomic read/write for JSON state files and workflow queries.
 *
 * Security: Reuses path validation patterns from validate-file.js.
 * Module pattern: Reuses export pattern from lib/init-directories.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows');
const ACTIVE_DIR = path.join(WORKFLOWS_DIR, 'active');
const COMPLETED_DIR = path.join(WORKFLOWS_DIR, 'completed');

/**
 * Validate a file path to prevent traversal attacks.
 * Only allows paths under ~/.claude/workflows/ or os.tmpdir().
 */
function validatePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return null;

  const dangerousPatterns = [
    /\.\.[\/\\]/,
    /[<>|"'`$(){}]/,
    /\0/,
    /^[\/\\]{2}/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(inputPath)) return null;
  }

  try {
    const resolved = path.resolve(inputPath);
    const allowedRoots = [
      path.resolve(WORKFLOWS_DIR),
      path.resolve(os.tmpdir()),
    ];

    const isAllowed = allowedRoots.some(root => {
      const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
      return resolved === root || resolved.startsWith(normalizedRoot);
    });

    return isAllowed ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Read a JSON state file. Returns null on any error.
 */
function readState(statePath) {
  const validated = validatePath(statePath);
  if (!validated) return null;

  try {
    const content = fs.readFileSync(validated, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write a JSON state file atomically (write to .tmp then rename).
 * Returns true on success, false on error.
 */
function writeState(statePath, obj) {
  const validated = validatePath(statePath);
  if (!validated) return false;

  const tmpPath = validated + '.tmp';
  try {
    const content = JSON.stringify(obj, null, 2) + '\n';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, validated);
    return true;
  } catch {
    try { fs.unlinkSync(tmpPath); } catch {}
    return false;
  }
}

/**
 * Read-modify-write pattern. fn receives current state, returns new state.
 * Automatically updates updated_at. Returns new state or null on error.
 */
function updateState(statePath, fn) {
  const current = readState(statePath);
  if (!current) return null;

  try {
    const updated = fn(current);
    if (!updated) return null;
    updated.updated_at = new Date().toISOString();
    return writeState(statePath, updated) ? updated : null;
  } catch {
    return null;
  }
}

/**
 * Scan for active .state.json files.
 * Returns array of { path, state } sorted by updated_at descending.
 */
function findActiveStates() {
  try {
    if (!fs.existsSync(ACTIVE_DIR)) return [];

    const files = fs.readdirSync(ACTIVE_DIR)
      .filter(f => f.endsWith('.state.json'));

    const states = [];
    for (const file of files) {
      const filePath = path.join(ACTIVE_DIR, file);
      const state = readState(filePath);
      if (state) {
        states.push({ path: filePath, state });
      }
    }

    states.sort((a, b) => {
      const dateA = new Date(a.state.updated_at || 0);
      const dateB = new Date(b.state.updated_at || 0);
      return dateB - dateA;
    });

    return states;
  } catch {
    return [];
  }
}

/**
 * Return the most recently updated active workflow.
 * Returns { path, state } or null.
 */
function getActiveWorkflow() {
  const states = findActiveStates();
  return states.length > 0 ? states[0] : null;
}

/**
 * Write a session marker file so skills can discover the session_id.
 * Writes /tmp/workflow-session-marker-{sessionId}.json.
 */
function writeSessionMarker(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  const markerPath = path.join(os.tmpdir(), `workflow-session-marker-${sessionId}.json`);
  try {
    const content = JSON.stringify({ session_id: sessionId, timestamp: new Date().toISOString() }) + '\n';
    fs.writeFileSync(markerPath, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Bind a session to a specific workflow.
 * Writes /tmp/workflow-binding-{sessionId}.json.
 */
function bindSessionToWorkflow(sessionId, workflowPath, workflowId) {
  if (!sessionId || !workflowPath) return false;
  const bindingPath = path.join(os.tmpdir(), `workflow-binding-${sessionId}.json`);
  try {
    const content = JSON.stringify({
      session_id: sessionId,
      workflow_path: workflowPath,
      workflow_id: workflowId || null,
      bound_at: new Date().toISOString(),
    }) + '\n';
    fs.writeFileSync(bindingPath, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the workflow bound to a session.
 * Reads the binding file, loads the state, and returns { path, state }.
 * Falls back to getActiveWorkflow() if no binding exists.
 */
function getWorkflowForSession(sessionId) {
  if (sessionId && typeof sessionId === 'string') {
    const bindingPath = path.join(os.tmpdir(), `workflow-binding-${sessionId}.json`);
    try {
      if (fs.existsSync(bindingPath)) {
        const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
        if (binding.workflow_path) {
          const state = readState(binding.workflow_path);
          if (state) {
            return { path: binding.workflow_path, state };
          }
        }
      }
    } catch {
      // Fall through to getActiveWorkflow()
    }
  }
  return getActiveWorkflow();
}

/**
 * Remove a session binding file.
 */
function clearSessionBinding(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  const bindingPath = path.join(os.tmpdir(), `workflow-binding-${sessionId}.json`);
  try {
    if (fs.existsSync(bindingPath)) {
      fs.unlinkSync(bindingPath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if all mandatory gates have passed.
 * Skipped gates are not mandatory.
 */
function allMandatoryGatesPassed(state) {
  if (!state || !state.gates) return false;

  for (const [, gate] of Object.entries(state.gates)) {
    if (gate.status === 'skipped') continue;
    if (gate.status !== 'passed') return false;
  }
  return true;
}

/**
 * Get list of gates that are not yet passed or skipped.
 */
function getPendingGates(state) {
  if (!state || !state.gates) return [];

  return Object.entries(state.gates)
    .filter(([, gate]) => gate.status !== 'passed' && gate.status !== 'skipped')
    .map(([name, gate]) => ({ name, ...gate }));
}

/**
 * Determine the next phase based on remaining phases.
 */
function getNextPhase(state) {
  if (!state || !state.phase) return null;
  const remaining = state.phase.remaining || [];
  return remaining.length > 0 ? remaining[0] : null;
}

/**
 * Compute a short SHA-256 checksum of the state for integrity verification.
 */
function computeChecksum(state) {
  if (!state) return null;
  const content = JSON.stringify(state);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Clean up all workflow-related temp files for a session.
 * Removes: markers, bindings, stop counters, stale files, deny files, completion counters.
 * Returns the number of files removed.
 */
function cleanupSessionTempFiles(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return 0;

  const tmpDir = os.tmpdir();
  const exactFiles = [
    `workflow-session-marker-${sessionId}.json`,
    `workflow-binding-${sessionId}.json`,
    `workflow-stop-${sessionId}.count`,
    `workflow-stop-${sessionId}.stale`,
    `workflow-deny-${sessionId}.json`,
  ];

  let cleaned = 0;

  for (const name of exactFiles) {
    const filePath = path.join(tmpDir, name);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch {
      // Best-effort cleanup
    }
  }

  // Remove completion counter files (workflow-complete-{sessionId}-*.count)
  try {
    const prefix = `workflow-complete-${sessionId}-`;
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.count')) {
        try {
          fs.unlinkSync(path.join(tmpDir, file));
          cleaned++;
        } catch {
          // Best-effort
        }
      }
    }
  } catch {
    // tmpdir listing failed, skip
  }

  return cleaned;
}

/**
 * Find orphaned org files (org/md files without a corresponding .state.json).
 */
function findOrphanedOrgFiles() {
  try {
    if (!fs.existsSync(ACTIVE_DIR)) return [];

    const files = fs.readdirSync(ACTIVE_DIR);
    const orgFiles = files.filter(f => f.endsWith('.org') || f.endsWith('.md'));
    const stateFiles = new Set(
      files.filter(f => f.endsWith('.state.json'))
        .map(f => f.replace('.state.json', ''))
    );

    return orgFiles.filter(f => {
      const base = f.replace(/\.(org|md)$/, '');
      return !stateFiles.has(base);
    }).map(f => path.join(ACTIVE_DIR, f));
  } catch {
    return [];
  }
}

module.exports = {
  WORKFLOWS_DIR,
  ACTIVE_DIR,
  COMPLETED_DIR,
  validatePath,
  readState,
  writeState,
  updateState,
  findActiveStates,
  getActiveWorkflow,
  writeSessionMarker,
  bindSessionToWorkflow,
  getWorkflowForSession,
  clearSessionBinding,
  cleanupSessionTempFiles,
  allMandatoryGatesPassed,
  getPendingGates,
  getNextPhase,
  computeChecksum,
  findOrphanedOrgFiles,
};
