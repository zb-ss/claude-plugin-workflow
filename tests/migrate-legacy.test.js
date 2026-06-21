/**
 * Tests for lib/migrate-legacy-cli.js — migrating unscoped legacy flat-root
 * workflow state into per-repo buckets (assign) or archiving it.
 *
 * The CLI is exercised as a subprocess (closest to how the skill invokes it) so
 * each run picks up CLAUDE_WORKFLOW_STATE_DIR / CLAUDE_WORKFLOW_REPO_KEY fresh.
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'lib', 'migrate-legacy-cli.js');
let stateRoot;

function run(args, extraEnv) {
  const env = Object.assign({}, process.env, { CLAUDE_WORKFLOW_STATE_DIR: stateRoot }, extraEnv || {});
  return execFileSync('node', [CLI, ...args], { env, encoding: 'utf8' }).trim();
}

function writeLegacy(id, extra) {
  const p = path.join(stateRoot, 'active', id + '.state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload = Object.assign(
    { workflow_id: id, org_file: '/old/flat/' + id + '.org', workflow: { type: 'feature', branch: 'x', description: id } },
    extra || {},
  );
  fs.writeFileSync(p, JSON.stringify(payload, null, 2));
  return p;
}

before(() => {
  stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ml-'));
});

after(() => {
  try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  for (const d of ['active', 'completed']) {
    try { fs.rmSync(path.join(stateRoot, d), { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(path.join(stateRoot, 'active'), { recursive: true });
});

describe('migrate-legacy CLI', () => {
  it('list returns only unstamped flat-root files', () => {
    writeLegacy('a');
    writeLegacy('b', { repo_key: 'already-scoped' }); // stamped → excluded
    const out = JSON.parse(run(['list']));
    assert.deepEqual(out.map(x => x.workflow_id).sort(), ['a']);
  });

  it('assign stamps repo_key/repo_root and moves state + org sibling into the bucket', () => {
    const p = writeLegacy('feat');
    fs.writeFileSync(path.join(stateRoot, 'active', 'feat.org'), '* org\n');

    run(['assign', p, stateRoot], { CLAUDE_WORKFLOW_REPO_KEY: 'myrepo' });

    // flat-root original is gone
    assert.equal(fs.existsSync(p), false);
    // moved into the bucket and stamped
    const dest = path.join(stateRoot, 'active', 'myrepo', 'feat.state.json');
    assert.equal(fs.existsSync(dest), true);
    const st = JSON.parse(fs.readFileSync(dest, 'utf8'));
    assert.equal(st.repo_key, 'myrepo');
    assert.ok(st.repo_root, 'repo_root stamped');
    assert.equal(st.org_file, path.join(stateRoot, 'active', 'myrepo', 'feat.org'));
    // org sibling moved alongside
    assert.equal(fs.existsSync(path.join(stateRoot, 'active', 'myrepo', 'feat.org')), true);
    // no longer listed as legacy
    assert.deepEqual(JSON.parse(run(['list'])), []);
  });

  it('archive moves the file into completed/_legacy-archived-<date>/', () => {
    const p = writeLegacy('old');
    run(['archive', p, '20260621']);
    assert.equal(fs.existsSync(p), false);
    assert.equal(
      fs.existsSync(path.join(stateRoot, 'completed', '_legacy-archived-20260621', 'old.state.json')),
      true,
    );
  });

  it('assign refuses an already-stamped file (non-zero exit)', () => {
    const p = writeLegacy('s', { repo_key: 'x' });
    assert.throws(() => run(['assign', p, stateRoot]));
  });
});
