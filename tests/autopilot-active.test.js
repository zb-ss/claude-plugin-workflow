/**
 * Tests for lib/autopilot-active-cli.js — the cross-bucket scan the driver uses
 * to find the single in-flight autopilot task regardless of which target repo's
 * bucket it lives in. This is the multi-repo correctness guarantee: one control
 * repo dispatching tasks to many target repos must still locate the active job.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findAutopilotStates } = require('../lib/autopilot-active-cli.js');

let base;

function writeState(repoKey, name, state) {
  const dir = path.join(base, repoKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(state));
}

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'apq-active-'));
  // Two autopilot tasks in DIFFERENT repo buckets + one manual (non-autopilot) run.
  writeState('repo-a-1111', 'w1.state.json', { repo_key: 'repo-a-1111', queue_issue_number: 5, updated_at: '2026-06-21T10:00:00Z' });
  writeState('repo-b-2222', 'w2.state.json', { repo_key: 'repo-b-2222', queue_issue_number: 7, updated_at: '2026-06-21T12:00:00Z' });
  writeState('repo-c-3333', 'manual.state.json', { repo_key: 'repo-c-3333', updated_at: '2026-06-21T13:00:00Z' }); // no queue_issue_number
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('findAutopilotStates (cross-bucket)', () => {
  it('finds autopilot tasks across ALL repo buckets, newest first', () => {
    const found = findAutopilotStates(base);
    assert.equal(found.length, 2);
    assert.equal(found[0].state.queue_issue_number, 7); // repo-b, newer
    assert.equal(found[1].state.queue_issue_number, 5); // repo-a, older
    assert.equal(found[0].repo_key, 'repo-b-2222');
  });

  it('ignores manual (non-autopilot) workflows — no queue_issue_number', () => {
    const found = findAutopilotStates(base);
    assert.ok(!found.some(s => s.repo_key === 'repo-c-3333'));
  });

  it('returns [] for a missing/empty active base', () => {
    assert.deepEqual(findAutopilotStates(path.join(base, 'does-not-exist')), []);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'apq-empty-'));
    assert.deepEqual(findAutopilotStates(empty), []);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('survives a half-written/corrupt state file without throwing', () => {
    const dir = path.join(base, 'repo-d-4444');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken.state.json'), '{ not valid json');
    const found = findAutopilotStates(base);
    assert.equal(found.length, 2); // still the two valid autopilot tasks
  });
});
