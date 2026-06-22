#!/usr/bin/env node
/**
 * Codex cross-model review lens.
 *
 * The fan-out review gate can add a Codex (GPT-5-codex family) reviewer for an
 * unbiased third pair of eyes from a DIFFERENT model family — less-correlated
 * blind spots than another same-family lens. Codex's `/codex:review` slash
 * command is `disable-model-invocation: true` (user-triggered), but it just runs
 * `codex-companion.mjs review`, which the supervisor can call directly via Bash:
 *
 *   node <companion> review --base <ref> --scope branch --background   → job id
 *   node <companion> status <id> --json                                → poll
 *   node <companion> result <id> --json                                → findings
 *
 * Codex result shape (schemas/review-output.schema.json):
 *   { verdict: 'approve'|'needs-attention', summary, findings: [{severity,title,body,file,line_start,line_end,confidence,recommendation}] }
 *
 * This module locates the companion (version-agnostic) and converts Codex's
 * findings into the workflow's [ISSUE-N] pool. The actual run is orchestrated by
 * the supervisor; the locate/arg/parse logic here is pure and unit-tested.
 *
 * Requires the user to have authenticated Codex once (`/codex:setup`, `codex login`).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CACHE = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'openai-codex', 'codex');

function compareVersionsDesc(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Locate the codex companion script (latest installed version), or null. */
function locateCompanion(opts) {
  const dir = (opts && opts.cacheDir) || DEFAULT_CACHE;
  let versions;
  try {
    versions = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  } catch { return null; }
  versions.sort(compareVersionsDesc);
  for (const v of versions) {
    const p = path.join(dir, v, 'scripts', 'codex-companion.mjs');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isAvailable(opts) { return locateCompanion(opts) != null; }

function buildReviewArgs(opts) {
  const o = opts || {};
  const args = ['review', '--scope', o.scope || 'branch'];
  if (o.base) args.push('--base', o.base);
  if (o.background !== false) args.push('--background');
  return args;
}
function buildStatusArgs(jobId) { return ['status', String(jobId), '--json']; }
function buildResultArgs(jobId) { return ['result', String(jobId), '--json']; }

const SEVERITY_MAP = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'MINOR' };

/** Normalize a Codex review-output object into the workflow's finding shape. */
function parseReview(obj) {
  const o = obj || {};
  const findings = Array.isArray(o.findings) ? o.findings : [];
  return {
    verdict: o.verdict || null,
    summary: o.summary || '',
    findings: findings.map(f => ({
      source: 'codex',
      severity: SEVERITY_MAP[f.severity] || 'MEDIUM',
      title: f.title || '',
      file: f.file || '',
      line: f.line_start != null ? f.line_start : null,
      line_end: f.line_end != null ? f.line_end : null,
      body: f.body || '',
      recommendation: f.recommendation || '',
      confidence: f.confidence != null ? f.confidence : null,
    })),
  };
}

/** Render parsed Codex findings as [ISSUE-N] lines to merge into the gate pool. */
function toIssueLines(parsed, startIndex) {
  const start = startIndex || 1;
  return (parsed.findings || []).map((f, i) => {
    const loc = f.file + (f.line != null ? ':' + f.line : '');
    return `- [ISSUE-${start + i}] [${f.severity}] [codex] ${f.title} - ${loc} - ${f.recommendation || f.body}`;
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--locate')) {
    const p = locateCompanion({});
    if (!p) { process.stderr.write('codex companion not found (is the openai-codex plugin installed?)\n'); process.exit(1); }
    process.stdout.write(p + '\n');
  } else if (argv.includes('--available')) {
    process.stdout.write(JSON.stringify({ available: isAvailable({}) }) + '\n');
  } else {
    process.stderr.write('usage: codex-review.js --locate | --available  (library: locateCompanion, buildReviewArgs, parseReview, toIssueLines)\n');
    process.exit(2);
  }
}

module.exports = {
  locateCompanion, isAvailable, compareVersionsDesc,
  buildReviewArgs, buildStatusArgs, buildResultArgs,
  parseReview, toIssueLines, SEVERITY_MAP,
};
