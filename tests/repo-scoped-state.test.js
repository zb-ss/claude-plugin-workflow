/**
 * Tests for repo-scoped findActiveStates() / findLegacyStates() /
 * countOtherRepoStates() in hooks/lib/state.js. The active dir layout is:
 *
 *   <state-root>/active/                 ← unscoped legacy flat-layout files
 *   <state-root>/active/<repo-key>/      ← per-repo bucket
 *
 * Workflow identity is self-describing: state objects carry a `repo_key`.
 * findActiveStates({ scope: 'current' }) returns ONLY workflows whose key
 * matches the current repo (bucket dir name or embedded repo_key) — it never
 * returns unscoped legacy files, which would otherwise bleed into every repo's
 * session. findLegacyStates() returns those unscoped files for a migrate notice.
 * countOtherRepoStates() returns the number of state files in *other* buckets.
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

  it('excludes unscoped legacy flat-layout files (no repo_key)', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    writeStateFile(path.join(base, 'legacy-1.state.json'), makeState('legacy-1'));

    const found = state.findActiveStates({ scope: 'current' });
    const ids = found.map(e => e.state.workflow_id).sort();
    assert.deepEqual(ids, ['a']); // legacy-1 is NOT surfaced as a current workflow
  });

  it('classifies a STAMPED flat-layout file by its repo_key, not its location', () => {
    const base = path.join(stateRoot, 'active');
    // Mislocated at the flat root but self-identifying as the current repo.
    writeStateFile(path.join(base, 'mis.state.json'), makeState('mis', { repo_key: 'repo-current' }));
    // Self-identifying as a different repo → excluded from "current".
    writeStateFile(path.join(base, 'elsewhere.state.json'), makeState('elsewhere', { repo_key: 'repo-other-z' }));

    const found = state.findActiveStates({ scope: 'current' });
    const ids = found.map(e => e.state.workflow_id).sort();
    assert.deepEqual(ids, ['mis']);
    assert.equal(found[0].scope, 'current');
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
  it('returns workflows from every repo bucket but NOT unscoped legacy', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    writeStateFile(path.join(base, 'repo-other-x', 'b.state.json'), makeState('b'));
    writeStateFile(path.join(base, 'legacy.state.json'), makeState('legacy'));

    const found = state.findActiveStates({ scope: 'all' });
    const ids = found.map(e => e.state.workflow_id).sort();
    assert.deepEqual(ids, ['a', 'b']); // unscoped legacy excluded
    const scopes = Object.fromEntries(found.map(e => [e.state.workflow_id, e.scope]));
    assert.equal(scopes.a, 'current');
    assert.equal(scopes.b, 'other:repo-other-x');
  });
});

describe('findLegacyStates()', () => {
  it('returns only unscoped flat-layout files (no repo_key)', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    writeStateFile(path.join(base, 'legacy-1.state.json'), makeState('legacy-1'));
    writeStateFile(path.join(base, 'stamped.state.json'), makeState('stamped', { repo_key: 'repo-current' }));

    const legacy = state.findLegacyStates();
    const ids = legacy.map(e => e.state.workflow_id).sort();
    assert.deepEqual(ids, ['legacy-1']); // bucket file and stamped flat file excluded
  });

  it('returns [] when there are no unscoped flat-layout files', () => {
    const base = path.join(stateRoot, 'active');
    writeStateFile(path.join(base, 'repo-current', 'a.state.json'), makeState('a'));
    assert.deepEqual(state.findLegacyStates(), []);
  });
});

describe('cross-repo isolation (resume safety)', () => {
  it('a workflow created in repo A is invisible to a session in repo B', () => {
    const base = path.join(stateRoot, 'active');
    // Workflow lives in repo A's bucket, stamped with repo A's key.
    writeStateFile(
      path.join(base, 'repo-A', 'feat.state.json'),
      makeState('feat', { repo_key: 'repo-A' }),
    );

    // Session B: switch the current repo key for the duration of this test.
    const saved = process.env.CLAUDE_WORKFLOW_REPO_KEY;
    process.env.CLAUDE_WORKFLOW_REPO_KEY = 'repo-B';
    try {
      const found = state.findActiveStates({ scope: 'current' });
      assert.deepEqual(found, []); // repo A's workflow does not leak into repo B
      assert.deepEqual(state.findLegacyStates(), []); // and is not mistaken for legacy
    } finally {
      process.env.CLAUDE_WORKFLOW_REPO_KEY = saved;
    }
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
