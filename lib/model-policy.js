#!/usr/bin/env node
/**
 * Model policy — single source of truth for which model each workflow role uses.
 *
 * Models change constantly, so the role→model map is config, not hardcoded in 16
 * agent frontmatters (per the "no hardcoded configurable values" rule). Agent
 * frontmatter remains as a fallback default; the supervisor resolves the model
 * via this policy and passes it explicitly when spawning, so the policy wins.
 *
 * Resolution precedence for a role (highest first):
 *   1. env  CLAUDE_WORKFLOW_MODEL_<ROLE>     (quick per-role experiment)
 *   2. policy file `overrides[role]`         (<stateDir>/model-policy.json)
 *   3. preset overrides                      (preset named in env/file)
 *   4. ROLE_DEFAULTS                          (built-in)
 * Then, for risk-aware presets, escalate to the higher tier for the given risk.
 *
 * Shipped default preset: 'all-opus' (reasoning AND coding on opus; only
 * mechanical/utility roles stay cheaper). Switch via the policy file or
 * CLAUDE_WORKFLOW_MODEL_POLICY=<preset>.
 *
 * CLI:
 *   node lib/model-policy.js <role> [--risk high|medium|low]   → prints the model
 *   node lib/model-policy.js --show                            → full resolved policy (JSON)
 *   node lib/model-policy.js --codex                           → codex-review config (JSON)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { getStateDir } = require('./paths');

const TIER_RANK = { haiku: 0, sonnet: 1, opus: 2 };

// Built-in role → model. This IS the 'all-opus' preset (executor on opus).
const ROLE_DEFAULTS = {
  architect: 'opus',
  reviewer: 'opus',
  security: 'opus',
  completion_guard: 'opus',
  spec_conformance: 'opus',
  executor: 'opus',            // all-opus coding (operator-selected default)
  codebase_analyzer: 'sonnet',
  quality_gate: 'sonnet',
  supervisor: 'sonnet',
  e2e: 'sonnet',
  epic_integrator: 'sonnet',
  test_writer: 'sonnet',
  web_tester: 'sonnet',
  explorer: 'haiku',
};

// Presets layer overrides on top of ROLE_DEFAULTS.
const PRESETS = {
  'all-opus': {},                                   // = ROLE_DEFAULTS — shipped default
  balanced: { executor: 'sonnet' },                 // classic: sonnet codes, opus reviews
  'risk-driven': { executor: 'sonnet' },            // base sonnet; escalate on high risk (below)
  economy: {
    executor: 'sonnet', architect: 'sonnet', reviewer: 'sonnet',
    security: 'sonnet', completion_guard: 'sonnet', spec_conformance: 'sonnet',
  },
};

// Risk-tier escalation, applied only for presets that opt in (risk-driven, or
// any policy with risk_aware:true). Escalation only ever RAISES the tier.
const RISK_ESCALATION = {
  executor: { high: 'opus', medium: 'opus', low: 'sonnet' },
};
const RISK_AWARE_PRESETS = new Set(['risk-driven']);

const DEFAULT_PRESET = 'all-opus';
const ENV_ROLE_PREFIX = 'CLAUDE_WORKFLOW_MODEL_';
const RESERVED_ENV = new Set(['POLICY', 'POLICY_FILE']); // not roles

function policyFilePath(opts) {
  return (opts && opts.file)
    || process.env.CLAUDE_WORKFLOW_MODEL_POLICY_FILE
    || path.join(getStateDir(), 'model-policy.json');
}

/** Load the policy { preset, overrides, risk_aware, codex_review } from file + env. */
function loadPolicy(opts) {
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(policyFilePath(opts), 'utf8')) || {}; }
  catch { fileCfg = {}; }

  const preset = (opts && opts.preset)
    || process.env.CLAUDE_WORKFLOW_MODEL_POLICY
    || fileCfg.preset
    || DEFAULT_PRESET;

  const overrides = Object.assign({}, fileCfg.overrides || {});
  // per-role env overrides (CLAUDE_WORKFLOW_MODEL_EXECUTOR=opus)
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith(ENV_ROLE_PREFIX)) continue;
    const role = k.slice(ENV_ROLE_PREFIX.length);
    if (RESERVED_ENV.has(role)) continue;
    overrides[role.toLowerCase()] = v;
  }

  const risk_aware = fileCfg.risk_aware === true || RISK_AWARE_PRESETS.has(preset);
  const codex_review = Object.assign(
    { enabled: false, scope: 'branch', mode: 'auto' },
    fileCfg.codex_review || {}
  );
  return { preset, overrides, risk_aware, codex_review };
}

/** Resolve the model for a role, optionally escalating by risk tier. */
function modelFor(role, opts) {
  const o = opts || {};
  const policy = o.policy || loadPolicy(o);
  const presetMap = PRESETS[policy.preset] || PRESETS[DEFAULT_PRESET];

  let model = policy.overrides[role]
    || presetMap[role]
    || ROLE_DEFAULTS[role]
    || 'sonnet';

  if (o.risk && policy.risk_aware && RISK_ESCALATION[role]) {
    const escalated = RISK_ESCALATION[role][o.risk];
    if (escalated && (TIER_RANK[escalated] ?? -1) > (TIER_RANK[model] ?? -1)) {
      model = escalated;
    }
  }
  return model;
}

/** Full resolved role→model map (for --show / inspection). */
function resolvePolicy(opts) {
  const policy = loadPolicy(opts);
  const roles = {};
  for (const role of Object.keys(ROLE_DEFAULTS)) {
    roles[role] = modelFor(role, Object.assign({}, opts, { policy }));
  }
  return { preset: policy.preset, risk_aware: policy.risk_aware, roles, codex_review: policy.codex_review };
}

function codexReview(opts) {
  return loadPolicy(opts).codex_review;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const riskIdx = argv.indexOf('--risk');
  const risk = riskIdx >= 0 ? argv[riskIdx + 1] : undefined;
  if (argv.includes('--show')) {
    process.stdout.write(JSON.stringify(resolvePolicy({}), null, 2) + '\n');
  } else if (argv.includes('--codex')) {
    process.stdout.write(JSON.stringify(codexReview({}), null, 2) + '\n');
  } else {
    const role = argv.find(a => !a.startsWith('--') && a !== risk);
    if (!role) { process.stderr.write('usage: model-policy.js <role> [--risk high|medium|low] | --show | --codex\n'); process.exit(2); }
    process.stdout.write(modelFor(role, { risk }) + '\n');
  }
}

module.exports = {
  modelFor, loadPolicy, resolvePolicy, codexReview, policyFilePath,
  ROLE_DEFAULTS, PRESETS, RISK_ESCALATION, TIER_RANK,
};
