#!/usr/bin/env node
/**
 * CLI: classify a diff's blast radius and scale review intensity accordingly.
 * Scans changed file paths AND diff content for sensitivity signals grouped by
 * category, then maps those signals to a risk level with concrete review gates.
 *
 * Signal → risk mapping:
 *   auth | payment | db_migration | destructive  → high
 *     (any one of these in isolation is enough; blast radius is broad/irreversible)
 *   crypto | public_api | secrets_config | infra  → medium
 *     (sensitive but recoverable — security deep-dive required, no human gate)
 *   none                                          → low
 *
 * diff_smell is a separate, orthogonal heuristic: a diff that is very large
 * (>800 changed lines OR >40 files) triggers extra scrutiny regardless of
 * signal category. It does not change the risk level — it just flags that
 * reviewers should be especially careful about what may have been buried.
 *
 * Usage:
 *   echo '{"diff":"...","files":["..."]}' | node lib/risk-classify-cli.js classify
 *   node lib/risk-classify-cli.js --git [<base-ref>]
 *
 * Output JSON: { risk, signals, review_depth, diff_smell }
 * Exit code:   0 always (classifier, not a blocker)
 */
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Signal definitions: each entry names a category, the pattern set to match,
// and the fields to scan (paths = file list, content = diff text, or both).
// ---------------------------------------------------------------------------
const SIGNAL_DEFS = [
  {
    category: 'auth',
    re: /auth|login|session|password|token|secret|credential|oauth|jwt/i,
    fields: ['paths', 'content'],
  },
  {
    category: 'payment',
    re: /payment|billing|charge|invoice|stripe|paypal/i,
    fields: ['paths', 'content'],
  },
  {
    category: 'db_migration',
    // ALTER TABLE / DROP TABLE / CREATE TABLE must also match in diff content
    re: /migration|schema|ALTER TABLE|DROP TABLE|CREATE TABLE/i,
    fields: ['paths', 'content'],
  },
  {
    category: 'public_api',
    re: /route|controller|endpoint|api\//i,
    fields: ['paths', 'content'],
  },
  {
    category: 'crypto',
    re: /encrypt|decrypt|sign|hash|cipher/i,
    fields: ['paths', 'content'],
  },
  {
    category: 'secrets_config',
    re: /\.env|secret|apikey|api_key/i,
    fields: ['paths', 'content'],
  },
  {
    category: 'infra',
    re: /Dockerfile|\.github\/workflows|deploy|terraform|IAM|policy|role/i,
    fields: ['paths', 'content'],
  },
  {
    category: 'destructive',
    // rm -rf, DROP (SQL), truncate, terminate, delete bucket — diff content only
    // for path-level matches we keep filenames like "truncate-logs.sh" in scope
    re: /rm -rf|DROP |truncate|terminate|delete bucket/i,
    fields: ['paths', 'content'],
  },
];

// High-risk categories: any match → risk=high, min 3 reviewers, human gate
const HIGH_CATEGORIES = new Set(['auth', 'payment', 'db_migration', 'destructive']);

// Default diff-smell thresholds (heuristic only — just flags extra scrutiny)
const DEFAULT_SMELL_LINES = 800;
const DEFAULT_SMELL_FILES = 40;

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/**
 * Count the number of added/removed lines in a unified diff.
 * We count lines starting with + or - (excluding the --- / +++ file headers).
 */
function countDiffLines(diffText) {
  if (!diffText || typeof diffText !== 'string') return 0;
  let n = 0;
  for (const line of diffText.split('\n')) {
    if ((line.startsWith('+') || line.startsWith('-')) &&
        !line.startsWith('+++') && !line.startsWith('---')) {
      n++;
    }
  }
  return n;
}

/**
 * Scan file paths and diff content for sensitivity signals.
 *
 * @param {string} diffText   - Unified diff text (may be empty string)
 * @param {string[]} files    - Changed file paths
 * @param {object} [opts]
 * @param {number} [opts.smell_lines=800] - Line threshold for diff_smell
 * @param {number} [opts.smell_files=40]  - File count threshold for diff_smell
 * @returns {{ risk, signals, review_depth, diff_smell }}
 */
function classify(diffText, files, opts) {
  const o = opts || {};
  const smell_lines = (typeof o.smell_lines === 'number') ? o.smell_lines : DEFAULT_SMELL_LINES;
  const smell_files = (typeof o.smell_files === 'number') ? o.smell_files : DEFAULT_SMELL_FILES;

  const diff   = typeof diffText === 'string' ? diffText : '';
  const paths  = Array.isArray(files) ? files.join('\n') : '';

  // Deduplicate signals: one entry per (category, where) pair
  const seen = new Set();
  const signals = [];

  for (const def of SIGNAL_DEFS) {
    for (const field of def.fields) {
      const text = field === 'paths' ? paths : diff;
      if (def.re.test(text)) {
        const key = `${def.category}:${field}`;
        if (!seen.has(key)) {
          seen.add(key);
          signals.push({ category: def.category, where: field });
        }
      }
    }
  }

  // Deduplicate to one signal per category (keep first where encountered)
  const byCategory = new Map();
  for (const s of signals) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, s);
  }
  const uniqueSignals = [...byCategory.values()];

  // Determine risk level
  let risk = 'low';
  for (const s of uniqueSignals) {
    if (HIGH_CATEGORIES.has(s.category)) { risk = 'high'; break; }
    risk = 'medium'; // any non-high signal lifts to at least medium
  }

  // Map risk to review_depth
  const review_depth = buildReviewDepth(risk);

  // diff_smell: orthogonal heuristic, does not affect risk
  const files_changed = Array.isArray(files) ? files.length : 0;
  const lines_changed = countDiffLines(diff);
  const flagged = lines_changed > smell_lines || files_changed > smell_files;
  const reasons = [];
  if (lines_changed > smell_lines) reasons.push(`${lines_changed} changed lines exceeds threshold of ${smell_lines}`);
  if (files_changed > smell_files) reasons.push(`${files_changed} changed files exceeds threshold of ${smell_files}`);
  const diff_smell = {
    flagged,
    files_changed,
    lines_changed,
    // reason is always a string; empty when not flagged
    reason: reasons.length ? reasons.join('; ') : 'within normal bounds — heuristic thresholds not exceeded',
  };

  return { risk, signals: uniqueSignals, review_depth, diff_smell };
}

/**
 * Build review_depth object from a resolved risk level.
 */
function buildReviewDepth(risk) {
  if (risk === 'high') {
    return { min_reviewers: 3, security: 'deep', require_human_gate: true };
  }
  if (risk === 'medium') {
    return { min_reviewers: 2, security: 'deep', require_human_gate: false };
  }
  // low
  return { min_reviewers: 1, security: 'standard', require_human_gate: false };
}

// ---------------------------------------------------------------------------
// Git helper — mirrors scrub-cli.js gatherFromGit structure
// ---------------------------------------------------------------------------

/**
 * Gather diff text and changed file list from git.
 *
 * @param {string} [base]  - Base ref for range comparison (e.g. 'main')
 * @param {string} [cwd]   - Working directory for git commands
 * @returns {{ diff:string, files:string[] }}
 */
function gatherFromGit(base, cwd) {
  const execOpts = { encoding: 'utf8' };
  if (cwd) execOpts.cwd = cwd;

  const git = (args) => {
    try { return execFileSync('git', args, execOpts); } catch { return ''; }
  };

  const diff  = base ? git(['diff', `${base}...HEAD`]) : git(['diff', '--cached']);
  const raw   = base
    ? git(['diff', '--name-only', `${base}...HEAD`])
    : git(['diff', '--name-only', '--cached']);
  const files = raw.split('\n').map(s => s.trim()).filter(Boolean);

  return { diff, files };
}

// ---------------------------------------------------------------------------
// CLI dispatch — guarded so require() has no side effects
// ---------------------------------------------------------------------------

function fail(msg) { process.stderr.write(`risk-classify: ${msg}\n`); process.exit(2); }

if (require.main === module) {
  const argv = process.argv.slice(2);

  let input;

  if (argv[0] === '--git') {
    const base = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
    input = gatherFromGit(base);
  } else if (argv[0] === 'classify' || argv.length === 0) {
    let stdin = '';
    try { stdin = fs.readFileSync(0, 'utf8'); } catch {}
    if (!stdin.trim()) fail('usage: classify (json on stdin) | --git [base]');
    try { input = JSON.parse(stdin); } catch { fail('invalid JSON on stdin'); }
  } else {
    fail('usage: classify (json on stdin) | --git [base]');
  }

  const result = classify(input.diff || '', input.files || []);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { classify, gatherFromGit, countDiffLines, buildReviewDepth, SIGNAL_DEFS };
