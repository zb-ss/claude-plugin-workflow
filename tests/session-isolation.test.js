/**
 * Regression tests for session isolation fix in hooks/lib/state.js.
 *
 * Before the fix, getWorkflowForSession() fell back to getActiveWorkflow()
 * when no session binding existed — any CC session would inherit the most
 * recent active workflow. After the fix it returns null for unbound sessions.
 *
 * Tests also cover cleanupStaleMarkers() added in the same change.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a unique temp directory under os.tmpdir() with the given prefix.
 * Returns the absolute path to the created directory.
 */
function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Write a JSON file at filePath with the given data.
 */
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Create a workflow-binding-{sessionId}.json file in os.tmpdir().
 * Returns the path that was written.
 */
function createBinding(sessionId, workflowPath, workflowId = 'test-workflow-id') {
  const bindingPath = path.join(os.tmpdir(), `workflow-binding-${sessionId}.json`);
  writeJson(bindingPath, {
    session_id: sessionId,
    workflow_path: workflowPath,
    workflow_id: workflowId,
    bound_at: new Date().toISOString(),
  });
  return bindingPath;
}

/**
 * Remove a file if it exists. Best-effort, does not throw.
 */
function unlinkIfExists(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

/**
 * Set mtime of a file to a specific Date (or timestamp in ms).
 * Uses fs.utimesSync which requires atime and mtime as seconds since epoch.
 */
function setMtime(filePath, dateOrMs) {
  const ms = typeof dateOrMs === 'number' ? dateOrMs : dateOrMs.getTime();
  const secs = ms / 1000;
  fs.utimesSync(filePath, secs, secs);
}

// ---------------------------------------------------------------------------
// Import the module under test.
// state.js uses os.tmpdir() at call time for binding lookups, so our test
// files written into os.tmpdir() will be found automatically.
// ---------------------------------------------------------------------------
const {
  getWorkflowForSession,
  cleanupStaleMarkers,
  bindSessionToWorkflow,
  writeSessionMarker,
} = require('../hooks/lib/state.js');

// ---------------------------------------------------------------------------
// Track every file this test suite creates so we can clean up reliably.
// ---------------------------------------------------------------------------
const createdFiles = [];

function trackFile(filePath) {
  createdFiles.push(filePath);
  return filePath;
}

function cleanupAllCreatedFiles() {
  for (const f of createdFiles) {
    unlinkIfExists(f);
  }
  createdFiles.length = 0;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Session Isolation — getWorkflowForSession()', () => {

  // Ensure every test leaves no leftover files in os.tmpdir()
  after(cleanupAllCreatedFiles);

  // -------------------------------------------------------------------------
  // Test 1: Unbound session returns null, not the active workflow
  // -------------------------------------------------------------------------
  it('returns null for an unbound session (no binding file)', () => {
    const sessionId = `test-isolation-unbound-${Date.now()}`;

    // Verify no stray binding file exists for this session id
    const bindingPath = path.join(os.tmpdir(), `workflow-binding-${sessionId}.json`);
    unlinkIfExists(bindingPath);

    const result = getWorkflowForSession(sessionId);

    assert.strictEqual(
      result,
      null,
      'getWorkflowForSession() must return null when no binding file exists'
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: Bound session returns { path, state }
  // -------------------------------------------------------------------------
  it('returns { path, state } for a session with a valid binding', () => {
    const sessionId = `test-isolation-bound-${Date.now()}`;

    // Create a minimal state file inside os.tmpdir() (allowed root for validatePath)
    const statePath = path.join(os.tmpdir(), `test-isolation-state-${Date.now()}.state.json`);
    const fakeState = {
      workflow_id: 'wf-bound-test',
      phase: { current: 'implementation', remaining: [] },
      gates: {},
      updated_at: new Date().toISOString(),
    };
    writeJson(statePath, fakeState);
    trackFile(statePath);

    const bindingPath = createBinding(sessionId, statePath);
    trackFile(bindingPath);

    const result = getWorkflowForSession(sessionId);

    assert.notStrictEqual(result, null, 'Should return a result object, not null');
    assert.strictEqual(typeof result, 'object', 'Result should be an object');
    assert.ok('path' in result, 'Result should have a "path" property');
    assert.ok('state' in result, 'Result should have a "state" property');
    assert.strictEqual(result.path, statePath, 'path should match the state file path');
    assert.strictEqual(
      result.state.workflow_id,
      'wf-bound-test',
      'state.workflow_id should match the written state'
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: Cross-session isolation — session B does not see session A's workflow
  // -------------------------------------------------------------------------
  it('session B (unbound) does not receive session A\'s bound workflow', () => {
    const sessionIdA = `test-isolation-cross-A-${Date.now()}`;
    const sessionIdB = `test-isolation-cross-B-${Date.now()}`;

    // Session A gets a binding pointing to a real state file
    const statePath = path.join(os.tmpdir(), `test-isolation-cross-state-${Date.now()}.state.json`);
    writeJson(statePath, {
      workflow_id: 'wf-session-a-only',
      phase: { current: 'planning', remaining: [] },
      gates: {},
      updated_at: new Date().toISOString(),
    });
    trackFile(statePath);

    const bindingPathA = createBinding(sessionIdA, statePath, 'wf-session-a-only');
    trackFile(bindingPathA);

    // Session B has NO binding file
    const bindingPathB = path.join(os.tmpdir(), `workflow-binding-${sessionIdB}.json`);
    unlinkIfExists(bindingPathB);

    const resultA = getWorkflowForSession(sessionIdA);
    const resultB = getWorkflowForSession(sessionIdB);

    assert.notStrictEqual(resultA, null, 'Session A should see its bound workflow');
    assert.strictEqual(
      resultA.state.workflow_id,
      'wf-session-a-only',
      'Session A should see the correct workflow'
    );

    assert.strictEqual(
      resultB,
      null,
      'Session B must return null and must NOT inherit session A\'s workflow'
    );
  });

  // -------------------------------------------------------------------------
  // Test 4: sessionId === 'unknown' returns null
  // -------------------------------------------------------------------------
  it('returns null when sessionId is "unknown"', () => {
    // The 'unknown' sentinel is rejected before even looking for a binding file
    const result = getWorkflowForSession('unknown');
    assert.strictEqual(
      result,
      null,
      'sessionId "unknown" must always return null without falling back to active workflow'
    );
  });

  // -------------------------------------------------------------------------
  // Test 5 (bonus): binding file pointing to a non-existent state returns null
  // -------------------------------------------------------------------------
  it('returns null when binding points to a missing state file', () => {
    const sessionId = `test-isolation-missing-state-${Date.now()}`;
    const missingStatePath = path.join(os.tmpdir(), `test-isolation-nonexistent-${Date.now()}.state.json`);

    const bindingPath = createBinding(sessionId, missingStatePath);
    trackFile(bindingPath);
    // Do NOT create missingStatePath — it should not exist

    const result = getWorkflowForSession(sessionId);
    assert.strictEqual(
      result,
      null,
      'Must return null when the bound state file does not exist'
    );
  });

  // -------------------------------------------------------------------------
  // Test 6 (bonus): null / undefined / non-string sessionId returns null
  // -------------------------------------------------------------------------
  it('returns null for null sessionId', () => {
    assert.strictEqual(getWorkflowForSession(null), null);
  });

  it('returns null for undefined sessionId', () => {
    assert.strictEqual(getWorkflowForSession(undefined), null);
  });

  it('returns null for empty string sessionId', () => {
    assert.strictEqual(getWorkflowForSession(''), null);
  });
});

// ---------------------------------------------------------------------------
// Suite: cleanupStaleMarkers()
// ---------------------------------------------------------------------------

describe('cleanupStaleMarkers()', () => {

  after(cleanupAllCreatedFiles);

  /**
   * Generate a unique file name for this test run so parallel test runs
   * do not collide.
   */
  function uniqueName(type, label) {
    return `${type}-${label}-${process.pid}-${Date.now()}`;
  }

  // -------------------------------------------------------------------------
  // Test 5: Old marker AND binding files are removed, fresh ones are kept
  // -------------------------------------------------------------------------
  it('removes stale marker and binding files older than maxAgeMs, keeps fresh ones', () => {
    const tmpDir = os.tmpdir();
    const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;

    // Stale files (mtime = 25 hours ago)
    const staleMarkerName = `workflow-session-marker-${uniqueName('stale', 'marker')}.json`;
    const staleBindingName = `workflow-binding-${uniqueName('stale', 'binding')}.json`;
    const staleMarkerPath = path.join(tmpDir, staleMarkerName);
    const staleBindingPath = path.join(tmpDir, staleBindingName);

    writeJson(staleMarkerPath, { session_id: 'stale-session', timestamp: new Date().toISOString() });
    writeJson(staleBindingPath, { session_id: 'stale-session', workflow_path: '/tmp/fake.json' });

    const staleTime = Date.now() - TWENTY_FIVE_HOURS_MS;
    setMtime(staleMarkerPath, staleTime);
    setMtime(staleBindingPath, staleTime);

    trackFile(staleMarkerPath);
    trackFile(staleBindingPath);

    // Fresh files (mtime = 1 hour ago — well within the 24h window)
    const freshMarkerName = `workflow-session-marker-${uniqueName('fresh', 'marker')}.json`;
    const freshBindingName = `workflow-binding-${uniqueName('fresh', 'binding')}.json`;
    const freshMarkerPath = path.join(tmpDir, freshMarkerName);
    const freshBindingPath = path.join(tmpDir, freshBindingName);

    writeJson(freshMarkerPath, { session_id: 'fresh-session', timestamp: new Date().toISOString() });
    writeJson(freshBindingPath, { session_id: 'fresh-session', workflow_path: '/tmp/fake.json' });

    // Fresh files keep their default mtime (now), so they are within the window
    trackFile(freshMarkerPath);
    trackFile(freshBindingPath);

    const removed = cleanupStaleMarkers(MAX_AGE_MS);

    // Stale files must be gone
    assert.strictEqual(
      fs.existsSync(staleMarkerPath),
      false,
      'Stale marker file must be deleted'
    );
    assert.strictEqual(
      fs.existsSync(staleBindingPath),
      false,
      'Stale binding file must be deleted'
    );

    // Fresh files must remain
    assert.strictEqual(
      fs.existsSync(freshMarkerPath),
      true,
      'Fresh marker file must NOT be deleted'
    );
    assert.strictEqual(
      fs.existsSync(freshBindingPath),
      true,
      'Fresh binding file must NOT be deleted'
    );

    // The function must report at least 2 deletions (the two stale files)
    assert.ok(
      removed >= 2,
      `cleanupStaleMarkers() should report at least 2 deletions, got ${removed}`
    );
  });

  // -------------------------------------------------------------------------
  // Test 6: Fresh marker is not deleted
  // -------------------------------------------------------------------------
  it('does not delete a marker file with a current timestamp', () => {
    const tmpDir = os.tmpdir();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;

    const markerName = `workflow-session-marker-${uniqueName('nodeletion', 'marker')}.json`;
    const markerPath = path.join(tmpDir, markerName);

    writeJson(markerPath, { session_id: 'fresh-now', timestamp: new Date().toISOString() });
    trackFile(markerPath);

    // mtime is "now" — well within the 24h window
    cleanupStaleMarkers(MAX_AGE_MS);

    assert.strictEqual(
      fs.existsSync(markerPath),
      true,
      'A marker with a current mtime must not be deleted by cleanupStaleMarkers()'
    );
  });

  // -------------------------------------------------------------------------
  // Test 7: cleanupStaleMarkers returns 0 when tmpdir has no matching files
  // -------------------------------------------------------------------------
  it('returns 0 when there are no workflow marker or binding files to clean', () => {
    // We cannot guarantee tmpdir is empty, but we can test the return type
    // and that the function is safe to call multiple times.
    const result = cleanupStaleMarkers(1); // 1ms max age — only files from before this instant
    assert.strictEqual(typeof result, 'number', 'cleanupStaleMarkers() must return a number');
    assert.ok(result >= 0, 'Return value must be non-negative');
  });

  // -------------------------------------------------------------------------
  // Test 8: Both marker and binding prefixes are covered
  // -------------------------------------------------------------------------
  it('cleans both workflow-session-marker-* and workflow-binding-* prefixes', () => {
    const tmpDir = os.tmpdir();
    const PAST_MS = Date.now() - (48 * 60 * 60 * 1000); // 48 hours ago
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;

    const staleMarkerName = `workflow-session-marker-${uniqueName('dual', 'marker')}.json`;
    const staleBindingName = `workflow-binding-${uniqueName('dual', 'binding')}.json`;
    const staleMarkerPath = path.join(tmpDir, staleMarkerName);
    const staleBindingPath = path.join(tmpDir, staleBindingName);

    writeJson(staleMarkerPath, { session_id: 'dual-test', timestamp: new Date(PAST_MS).toISOString() });
    writeJson(staleBindingPath, { session_id: 'dual-test', workflow_path: '/tmp/fake.json' });
    setMtime(staleMarkerPath, PAST_MS);
    setMtime(staleBindingPath, PAST_MS);

    trackFile(staleMarkerPath);
    trackFile(staleBindingPath);

    const removed = cleanupStaleMarkers(MAX_AGE_MS);

    assert.strictEqual(fs.existsSync(staleMarkerPath), false, 'Stale marker must be deleted');
    assert.strictEqual(fs.existsSync(staleBindingPath), false, 'Stale binding must be deleted');
    assert.ok(removed >= 2, `Expected at least 2 deletions, got ${removed}`);
  });
});
