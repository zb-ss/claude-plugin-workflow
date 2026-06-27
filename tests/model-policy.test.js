/**
 * Tests for lib/model-policy.js — the configurable role→model resolver.
 * All cases pass an explicit (non-existent or temp) `file` so they're isolated
 * from any real ~/.claude-workflows/model-policy.json and from each other.
 */

'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { modelFor, resolvePolicy, codexReview } = require('../lib/model-policy.js');

const NOFILE = path.join(os.tmpdir(), 'mp-does-not-exist-' + process.pid + '.json');
const base = (preset) => ({ file: NOFILE, preset });

function withFile(cfg, fn) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-')) + '/model-policy.json';
  fs.writeFileSync(p, JSON.stringify(cfg));
  try { return fn(p); } finally { fs.rmSync(path.dirname(p), { recursive: true, force: true }); }
}

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('CLAUDE_WORKFLOW_MODEL_')) delete process.env[k];
  }
});

describe('default preset (all-opus coding)', () => {
  it('puts reasoning AND coding on opus, utility on haiku', () => {
    assert.equal(modelFor('executor', base('all-opus')), 'opus');
    assert.equal(modelFor('reviewer', base('all-opus')), 'opus');
    assert.equal(modelFor('architect', base('all-opus')), 'opus');
    assert.equal(modelFor('spec_conformance', base('all-opus')), 'opus');
    assert.equal(modelFor('quality_gate', base('all-opus')), 'sonnet');
    assert.equal(modelFor('explorer', base('all-opus')), 'haiku');
  });
});

describe('presets', () => {
  it('balanced: sonnet codes, opus reviews', () => {
    assert.equal(modelFor('executor', base('balanced')), 'sonnet');
    assert.equal(modelFor('reviewer', base('balanced')), 'opus');
  });

  it('economy: reasoning roles drop to sonnet', () => {
    assert.equal(modelFor('reviewer', base('economy')), 'sonnet');
    assert.equal(modelFor('security', base('economy')), 'sonnet');
    assert.equal(modelFor('executor', base('economy')), 'sonnet');
  });

  it('risk-driven: executor escalates sonnet→opus on high risk only', () => {
    assert.equal(modelFor('executor', { ...base('risk-driven'), risk: 'low' }), 'sonnet');
    assert.equal(modelFor('executor', { ...base('risk-driven'), risk: 'high' }), 'opus');
    assert.equal(modelFor('executor', base('risk-driven')), 'sonnet'); // no risk → base
  });

  it('non-risk-aware presets ignore the risk tier', () => {
    assert.equal(modelFor('executor', { ...base('balanced'), risk: 'high' }), 'sonnet');
  });
});

describe('override precedence', () => {
  it('per-role env var beats everything', () => {
    process.env.CLAUDE_WORKFLOW_MODEL_EXECUTOR = 'haiku';
    assert.equal(modelFor('executor', base('all-opus')), 'haiku');
  });

  it('policy-file overrides beat the preset', () => {
    withFile({ preset: 'all-opus', overrides: { executor: 'sonnet' } }, (p) => {
      assert.equal(modelFor('executor', { file: p }), 'sonnet');
      assert.equal(modelFor('reviewer', { file: p }), 'opus'); // untouched
    });
  });
});

describe('codex review config', () => {
  it('defaults to disabled', () => {
    assert.equal(codexReview(base('all-opus')).enabled, false);
  });
  it('reads enabled + scope from the policy file', () => {
    withFile({ codex_review: { enabled: true, scope: 'branch', mode: 'auto' } }, (p) => {
      const c = codexReview({ file: p });
      assert.equal(c.enabled, true);
      assert.equal(c.scope, 'branch');
    });
  });
});

describe('resolvePolicy', () => {
  it('returns the full role map + preset + codex config', () => {
    const r = resolvePolicy(base('balanced'));
    assert.equal(r.preset, 'balanced');
    assert.equal(r.roles.executor, 'sonnet');
    assert.equal(r.roles.reviewer, 'opus');
    assert.equal(typeof r.codex_review.enabled, 'boolean');
  });
});
