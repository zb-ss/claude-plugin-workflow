/**
 * End-to-end isolation test: spawns the real session-start.js hook and asserts
 * that a workflow created in repo A does NOT surface in a session keyed to
 * repo B, and that an unscoped legacy file appears only as a migrate notice.
 *
 * This is the regression guard for the original cross-repo leak.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'session-start.js');
let stateRoot;

function writeState(rel, payload) {
  const p = path.join(stateRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(payload, null, 2));
}

/** Run the hook with a given current-repo key; returns its additionalContext (or ''). */
function runSessionStart(repoKey) {
  const out = execFileSync('node', [HOOK], {
    cwd: REPO_ROOT,
    input: '{}',
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      CLAUDE_WORKFLOW_STATE_DIR: stateRoot,
      CLAUDE_WORKFLOW_REPO_KEY: repoKey,
    }),
  }).trim();
  if (!out) return '';
  try {
    return JSON.parse(out).hookSpecificOutput.additionalContext || '';
  } catch {
    return out;
  }
}

before(() => {
  stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-iso-e2e-'));
  // Repo A's workflow (stamped) + an unscoped legacy flat file.
  writeState('active/repo-a/wf1.state.json', {
    workflow_id: 'wf1', repo_key: 'repo-a', org_file: 'x',
    workflow: { type: 'swarm', description: 'repoA work' },
    mode: { current: 'swarm' }, phase: { current: 'implementation' }, gates: {},
  });
  writeState('active/legacy-old.state.json', {
    workflow_id: 'legacy-old', org_file: 'y',
    workflow: { type: 'epic' }, mode: { current: 'epic' }, phase: { current: 'tests' }, gates: {},
  });
});

after(() => {
  try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch {}
});

describe('session-start isolation (e2e)', () => {
  it('a session in repo B does NOT see repo A\'s workflow as resumable', () => {
    const ctx = runSessionStart('repo-b');
    assert.ok(!ctx.includes('## Active Workflows'), 'no resumable Active Workflows section for repo B');
    assert.ok(!ctx.includes('wf1'), 'repo A workflow id must not appear');
    assert.match(ctx, /other repositories/, 'repo A is summarized as a hidden other-repo count');
  });

  it('surfaces the unscoped legacy file only as a migrate notice', () => {
    const ctx = runSessionStart('repo-b');
    assert.match(ctx, /Unscoped legacy/, 'legacy migrate-notice heading present');
    assert.ok(ctx.includes('legacy-old'), 'legacy workflow id listed under the notice');
    assert.match(ctx, /migrate-legacy/, 'points at the migrate-legacy command');
  });

  it('a session in repo A DOES see repo A\'s workflow as resumable', () => {
    const ctx = runSessionStart('repo-a');
    assert.match(ctx, /## Active Workflows/, 'resumable section present for the owning repo');
    assert.ok(ctx.includes('wf1'), 'repo A workflow surfaced in its own session');
  });
});
