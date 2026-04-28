/**
 * Tests for repo-scoped findActiveStates() / countOtherRepoStates() in
 * hooks/lib/state.js. The active dir layout is:
 *
 *   <state-root>/active/                 ← legacy flat-layout files
 *   <state-root>/active/<repo-key>/      ← per-repo bucket
 *
 * findActiveStates({ scope: 'current' }) returns the current repo's bucket
 * + legacy flat files. countOtherRepoStates() returns the total number of
 * state files in *other* repo buckets.
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let stateRoot;
let savedStateDir;
let savedRepoKey;
let state;

function writeStateFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

function makeState(id, extras) {
  return Object.assign({
    workflow_id: id,
    workflow: { type: 'feature', description: id },
    mode: { current: 'standard' },
    phase: { current: 'planning' },
    gates: {},
    updated_at: new Date().toISOString(),
  }, extras || {});
}

before(() => {
  savedStateDir = process.env.CLAUDE_WORKFLOW_STATE_DIR;
  savedRepoKey = process.env.CLAUDE_WORKFLOW_REPO_KEY;
  stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rs-state-'));
  process.env.CLAUDE_WORKFLOW_STATE_DIR = stateRoot;
  process.env.CLAUDE_WORKFLOW_REPO_KEY = 'repo-current';
  // require *after* env vars so module-load picks them up
  state = require('../hooks/lib/state.js');
});

after(() => {
  if (savedStateDir === undefined) delete process.env.CLAUDE_WORKFLOW_STATE_DIR;
  else process.env.CLAUDE_WORKFLOW_STATE_DIR = savedStateDir;
  if (savedRepoKey === undefined) delete process.env.CLAUDE_WORKFLOW_REPO_KEY;
  else process.env.CLAUDE_WORKFLOW_REPO_KEY = savedRepoKey;
  try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  // wipe active/ between tests
  const activeBase = path.join(stateRoot, 'active');
  try { fs.rmSync(activeBase, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(activeBase, { recursive: true });
});

describe('findActiveStates({ scope: "current" })', () => {
  it('returns workflows from the current repo bucket only', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    writeStateFile(path.join(base, 'repo-other-x', 'b.state.json'), makeState('b'));
    writeStateFile(path.join(base, 'repo-other-y', 'c.state.json'), makeState('c'));

    const found = state.findActiveStates({ scope: 'current' });
    const ids = found.map(e => e.state.workflow_id).sort();
    assert.deepEqual(ids, ['a']);
    assert.equal(found[0].scope, 'current');
  });

  it('also returns legacy flat-layout files (scope tag = "legacy")', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    writeStateFile(path.join(base, 'legacy-1.state.json'), makeState('legacy-1'));

    const found = state.findActiveStates({ scope: 'current' });
    const byScope = Object.fromEntries(found.map(e => [e.state.workflow_id, e.scope]));
    assert.deepEqual(byScope, { 'a': 'current', 'legacy-1': 'legacy' });
  });

  it('ignores reserved subdirs starting with "_"', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, '_archive', 'old.state.json'), makeState('old'));
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));

    const found = state.findActiveStates({ scope: 'current' });
    const ids = found.map(e => e.state.workflow_id).sort();
    assert.deepEqual(ids, ['a']);
  });

  it('returns [] when active dir does not exist', () => {
    try { fs.rmSync(path.join(stateRoot, 'active'), { recursive: true, force: true }); } catch {}
    assert.deepEqual(state.findActiveStates({ scope: 'current' }), []);
  });
});

describe('findActiveStates({ scope: "all" })', () => {
  it('returns workflows from every repo bucket plus legacy', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    writeStateFile(path.join(base, 'repo-other-x', 'b.state.json'), makeState('b'));
    writeStateFile(path.join(base, 'legacy.state.json'), makeState('legacy'));

    const found = state.findActiveStates({ scope: 'all' });
    const ids = found.map(e => e.state.workflow_id).sort();
    assert.deepEqual(ids, ['a', 'b', 'legacy']);
    const scopes = Object.fromEntries(found.map(e => [e.state.workflow_id, e.scope]));
    assert.equal(scopes.a, 'current');
    assert.equal(scopes.b, 'other:repo-other-x');
    assert.equal(scopes.legacy, 'legacy');
  });
});

describe('countOtherRepoStates()', () => {
  it('counts state files in non-current repo subdirs', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    writeStateFile(path.join(base, 'repo-other-x', 'b.state.json'), makeState('b'));
    writeStateFile(path.join(base, 'repo-other-y', 'c.state.json'), makeState('c'));
    writeStateFile(path.join(base, 'repo-other-y', 'd.state.json'), makeState('d'));
    writeStateFile(path.join(base, 'legacy.state.json'), makeState('legacy'));

    assert.equal(state.countOtherRepoStates(), 3);
  });

  it('returns 0 when only current and legacy exist', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    writeStateFile(path.join(base, 'legacy.state.json'), makeState('legacy'));

    assert.equal(state.countOtherRepoStates(), 0);
  });

  it('returns 0 when active dir does not exist', () => {
    try { fs.rmSync(path.join(stateRoot, 'active'), { recursive: true, force: true }); } catch {}
    assert.equal(state.countOtherRepoStates(), 0);
  });
});
