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
const { log } = require('./logger');
const {
  getStateDir,
  getActiveBaseDir,
  getCompletedBaseDir,
} = require('../../lib/paths');
const { getRepoKey } = require('../../lib/repo-key');

const WORKFLOWS_DIR = getStateDir();
// Repo-independent base dirs (parents of all per-repo buckets). The per-repo
// active/completed dirs are intentionally NOT cached at module load: a hook's
// launch cwd is not guaranteed to be the session's repo, so any code that needs
// a repo-scoped path must derive it per-call from an explicit cwd (getActiveDir
// in lib/paths). validatePath only requires WORKFLOWS_DIR.
const ACTIVE_BASE_DIR = getActiveBaseDir();
const COMPLETED_BASE_DIR = getCompletedBaseDir();

/**
 * Validate a file path to prevent traversal attacks.
 * Only allows paths under the workflow state directory or os.tmpdir().
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

  // Refuse to write a *.state.json directly into the flat active/ root. Such a
  // file carries no repo bucket and would be surfaced as unscoped "legacy" in
  // every repo's session (the historical cross-repo leak). All workflow state
  // must live in a per-repo bucket (active/<repo-key>/) or under completed/.
  if (
    validated.endsWith('.state.json') &&
    path.resolve(path.dirname(validated)) === path.resolve(ACTIVE_BASE_DIR)
  ) {
    return false;
  }

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
 * Collect .state.json files in a single directory (non-recursive).
 * Returns array of { path, state }.
 */
function readStatesInDir(dir) {
  const out = [];
  try {
    if (!fs.existsSync(dir)) return out;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.state.json')) continue;
      const filePath = path.join(dir, entry.name);
      const state = readState(filePath);
      if (state) out.push({ path: filePath, state });
    }
  } catch {
    // ignore — return whatever was collected
  }
  return out;
}

/**
 * Scan for active .state.json files.
 *
 * @param {Object} [opts]
 * @param {string} [opts.cwd] - cwd used to derive the current repo-key
 *   (defaults to process.cwd()).
 * @param {string} [opts.scope] - 'current' (default) returns workflows for the
 *   current repo plus legacy flat-layout files; 'all' returns workflows from
 *   every repo bucket plus legacy.
 * @returns {Array<{path:string, state:object, scope:string}>} sorted by
 *   updated_at descending. Each entry includes its `scope`: 'current',
 *   'other:<repo-key>', or 'legacy'.
 */
function findActiveStates(opts) {
  const o = opts || {};
  const scope = o.scope || 'current';
  const collected = [];

  try {
    if (!fs.existsSync(ACTIVE_BASE_DIR)) return [];

    let currentKey = null;
    try {
      currentKey = getRepoKey(o.cwd);
    } catch {
      // No repo key — only self-identifying (stamped) files can be classified;
      // unstamped legacy files are excluded here (see findLegacyStates).
    }

    // Stamped flat-layout files (self-identifying via repo_key, e.g. mislocated
    // or mid-migration). Classify by the embedded key. UNSTAMPED legacy files
    // are intentionally NOT returned here — they belong to no repo and surface
    // only via findLegacyStates() as a migrate-or-archive notice.
    for (const entry of readStatesInDir(ACTIVE_BASE_DIR)) {
      const fileKey = entry.state && entry.state.repo_key;
      if (!fileKey) continue;
      const isCurrent = fileKey === currentKey;
      if (scope === 'current' && !isCurrent) continue;
      collected.push({ ...entry, scope: isCurrent ? 'current' : `other:${fileKey}` });
    }

    // Per-repo subdirectories. The directory name is the repo-key; a stamped
    // state's embedded repo_key is preferred so a file in the wrong bucket still
    // resolves to its true owner rather than its location.
    const subdirs = fs.readdirSync(ACTIVE_BASE_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    for (const sub of subdirs) {
      // Treat directories starting with "_" as reserved (e.g., _archive).
      if (sub.startsWith('_')) continue;
      const states = readStatesInDir(path.join(ACTIVE_BASE_DIR, sub));
      for (const entry of states) {
        const fileKey = (entry.state && entry.state.repo_key) || sub;
        const isCurrent = fileKey === currentKey;
        if (scope === 'current' && !isCurrent) continue;
        collected.push({ ...entry, scope: isCurrent ? 'current' : `other:${fileKey}` });
      }
    }

    collected.sort((a, b) => {
      const dateA = new Date(a.state.updated_at || 0);
      const dateB = new Date(b.state.updated_at || 0);
      return dateB - dateA;
    });

    return collected;
  } catch {
    return [];
  }
}

/**
 * Find unscoped legacy flat-layout state files (no repo_key) at the active root.
 * These predate repo-scoping and belong to no repository. They are surfaced only
 * as a migrate-or-archive notice — never as resumable workflows for the current
 * repo. This is what stops pre-scoping workflows from bleeding into every session.
 *
 * @returns {Array<{path:string, state:object}>}
 */
function findLegacyStates() {
  const out = [];
  for (const entry of readStatesInDir(ACTIVE_BASE_DIR)) {
    if (entry.state && entry.state.repo_key) continue; // stamped → findActiveStates
    out.push(entry);
  }
  return out;
}

/**
 * Count workflows that exist in repo buckets *other* than the current cwd's.
 * Cheap helper for the SessionStart "N workflows in other repos" hint.
 */
function countOtherRepoStates(opts) {
  const o = opts || {};
  let currentKey = null;
  try { currentKey = getRepoKey(o.cwd); } catch { /* ignore */ }
  let count = 0;
  try {
    if (!fs.existsSync(ACTIVE_BASE_DIR)) return 0;
    const subdirs = fs.readdirSync(ACTIVE_BASE_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('_'))
      .map(e => e.name);
    for (const sub of subdirs) {
      if (sub === currentKey) continue;
      try {
        const files = fs.readdirSync(path.join(ACTIVE_BASE_DIR, sub))
          .filter(f => f.endsWith('.state.json'));
        count += files.length;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return count;
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
 * Returns null if no binding exists — unbound sessions are not affected by hooks.
 */
function getWorkflowForSession(sessionId) {
  if (sessionId && typeof sessionId === 'string' && sessionId !== 'unknown') {
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
      // No valid binding — return null (no fallback to global state)
    }
  }
  return null;  // Unbound sessions are not affected by hooks
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
 * Clean up stale session marker and binding files older than maxAgeMs milliseconds.
 * Uses mtime (no JSON parsing) for efficiency. Also removes orphaned binding files.
 * Returns the number of files removed.
 */
function cleanupStaleMarkers(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir).filter(f =>
      (f.startsWith('workflow-session-marker-') || f.startsWith('workflow-binding-')) && f.endsWith('.json')
    );
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;
    for (const file of files) {
      try {
        const filePath = path.join(tmpDir, file);
        // Use mtime for efficiency — no need to open/parse each file
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // Skip files we can't stat/delete
      }
    }
    if (cleaned > 0) {
      log('state', `Cleaned up ${cleaned} stale session temp file(s)`);
    }
    return cleaned;
  } catch {
    return 0;
  }
}

/**
 * Find orphaned org files (org/md files without a corresponding .state.json)
 * across the current repo's bucket and the legacy flat layout.
 */
function findOrphanedOrgFiles(opts) {
  const o = opts || {};
  const dirs = [ACTIVE_BASE_DIR];
  try {
    const key = getRepoKey(o.cwd);
    dirs.push(path.join(ACTIVE_BASE_DIR, key));
  } catch { /* ignore */ }

  const orphans = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isFile())
        .map(e => e.name);
      const orgFiles = files.filter(f => f.endsWith('.org') || f.endsWith('.md'));
      const stateFiles = new Set(
        files.filter(f => f.endsWith('.state.json'))
          .map(f => f.replace('.state.json', ''))
      );
      for (const f of orgFiles) {
        const base = f.replace(/\.(org|md)$/, '');
        if (!stateFiles.has(base)) orphans.push(path.join(dir, f));
      }
    } catch { /* ignore this dir */ }
  }
  return orphans;
}

module.exports = {
  WORKFLOWS_DIR,
  ACTIVE_BASE_DIR,
  COMPLETED_BASE_DIR,
  validatePath,
  readState,
  writeState,
  updateState,
  findActiveStates,
  findLegacyStates,
  countOtherRepoStates,
  getActiveWorkflow,
  writeSessionMarker,
  bindSessionToWorkflow,
  getWorkflowForSession,
  clearSessionBinding,
  cleanupSessionTempFiles,
  cleanupStaleMarkers,
  allMandatoryGatesPassed,
  getPendingGates,
  getNextPhase,
  computeChecksum,
  findOrphanedOrgFiles,
};
