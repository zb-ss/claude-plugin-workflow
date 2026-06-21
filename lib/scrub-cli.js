#!/usr/bin/env node
/**
 * CLI: scan a "crossing surface" (branch name, commit messages, staged diff, PR
 * title/body, changed-file list) for internal-information markers BEFORE any
 * write reaches a non-private repo. This is the marker engine behind the scrub
 * gate; the PreToolUse hook (scrub-guard.js) gathers the surface and calls it.
 *
 * It enforces the global CLAUDE.md "Never Leak Internal Information" rule on the
 * actual bytes (prose AND code/tests/fixtures), in two parts:
 *   1. Built-in STRUCTURAL patterns — secrets, AI-assistant context filenames,
 *      and real (non-neutral) public IPs. These need no configuration.
 *   2. A runtime-editable DENYLIST of names that only the operator knows —
 *      customer/project/brand names, internal hostnames, agent/peer names,
 *      internal feature-flag names. This file MUST live in the PRIVATE control
 *      repo (or a local path), NEVER in this (public) plugin source. Path comes
 *      from CLAUDE_WORKFLOW_SCRUB_DENYLIST or the `--denylist <path>` flag.
 *
 * The gate errs toward blocking: a false positive costs one human glance; a
 * false negative leaks to a public repo permanently (forward-hygiene only — this
 * tool never rewrites history, it only blocks the new write).
 *
 * Usage:
 *   echo '<json surface>' | node lib/scrub-cli.js scan [--denylist <path>]
 *   node lib/scrub-cli.js --git [<base-ref>] [--denylist <path>]
 *
 * Surface JSON: { branch, commits:[..], diff, pr_title, pr_body, files:[..] }
 * Output JSON:  { clean, denylist_loaded, hits:[{category, match, where}] }
 * Exit code:    0 = clean, 1 = markers found (BLOCK), 2 = usage/error.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// --- Structural secret patterns (high-signal; case-sensitive where it matters) -
const SECRET_PATTERNS = [
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github_token', re: /\bgh[posru]_[A-Za-z0-9]{30,}\b/ },
  { name: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'private_key_block', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9_\-.=]{20,}/ },
  { name: 'connection_string', re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i },
  // secret-ish assignment with a non-placeholder value
  {
    name: 'secret_assignment',
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{8,})["']?/i,
    placeholder: true,
  },
];

// Values that look like secrets but are obviously placeholders → not a hit.
const PLACEHOLDER_RE = /^(?:x{3,}|y{3,}|z{3,}|0{3,}|changeme|example|placeholder|your[_-].*|my[_-].*|<.*>|\.{3,}|redacted|todo|null|none|test|dummy|sample|foo|bar|baz)$/i;

// AI-assistant context files that must never reach a public repo.
const AI_CONTEXT_FILES = new Set([
  'claude.md', 'gemini.md', 'agents.md', 'copilot-instructions.md',
  '.cursorrules', '.windsurfrules', '.clinerules', '.aider.conf.yml',
]);

const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Neutral public IPs explicitly allowed in tests/docs.
const NEUTRAL_IPS = new Set(['1.1.1.1', '8.8.8.8', '8.8.4.4', '9.9.9.9']);

function octets(ip) { return ip.split('.').map(Number); }
function validIpv4(ip) {
  const o = octets(ip);
  return o.length === 4 && o.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
}
/** Private / reserved / documentation ranges are safe to commit. */
function isNonRoutableOrDoc(ip) {
  const [a, b, c] = octets(ip);
  if (a === 10 || a === 127 || a === 0) return true;                 // private / loopback / this-host
  if (a === 172 && b >= 16 && b <= 31) return true;                  // private
  if (a === 192 && b === 168) return true;                           // private
  if (a === 169 && b === 254) return true;                           // link-local
  if (a >= 224) return true;                                         // multicast / reserved
  if (a === 192 && b === 0 && c === 2) return true;                  // RFC-5737 doc
  if (a === 198 && b === 51 && c === 100) return true;               // RFC-5737 doc
  if (a === 203 && b === 0 && c === 113) return true;                // RFC-5737 doc
  if (a === 198 && (b === 18 || b === 19)) return true;              // benchmarking
  return false;
}

/** Load the operator denylist (names only the operator knows). */
function loadDenylist(denylistPath) {
  const p = denylistPath || process.env.CLAUDE_WORKFLOW_SCRUB_DENYLIST;
  if (!p) return { loaded: false, entries: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const entries = (raw.entries || []).map(e => ({
      category: e.category || 'denylist',
      label: e.label || e.pattern,
      re: e.regex ? new RegExp(e.pattern, 'i') : literalRe(e.pattern),
    }));
    return { loaded: true, entries };
  } catch {
    return { loaded: false, entries: [] };
  }
}

function literalRe(s) {
  return new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/** Scan a blob of text. Returns an array of {category, match, where}. */
function scanText(text, where, denylist) {
  const out = [];
  if (!text || typeof text !== 'string') return out;

  for (const p of SECRET_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    if (p.placeholder && m[1] && PLACEHOLDER_RE.test(m[1])) continue;
    out.push({ category: 'secret', match: `${p.name}`, where });
  }

  let ipMatch;
  IPV4_RE.lastIndex = 0;
  while ((ipMatch = IPV4_RE.exec(text)) !== null) {
    const ip = ipMatch[0];
    if (!validIpv4(ip)) continue;
    if (NEUTRAL_IPS.has(ip) || isNonRoutableOrDoc(ip)) continue;
    out.push({ category: 'public_ip', match: ip, where });
  }

  for (const e of (denylist || [])) {
    if (e.re.test(text)) out.push({ category: e.category, match: e.label, where });
  }
  return out;
}

/** Scan a changed-file list for AI-assistant context files. */
function scanFiles(files) {
  const out = [];
  for (const f of (files || [])) {
    const base = String(f).replace(/\\/g, '/').split('/').pop().toLowerCase();
    if (AI_CONTEXT_FILES.has(base)) {
      out.push({ category: 'ai_context_file', match: f, where: 'files' });
    }
  }
  return out;
}

/**
 * Scan the full crossing surface.
 * @returns {{clean:boolean, denylist_loaded:boolean, hits:Array}}
 */
function scanSurface(surface, opts) {
  const o = opts || {};
  const dl = o.denylist || loadDenylist(o.denylistPath);
  const s = surface || {};
  const hits = [];

  hits.push(...scanText(s.branch, 'branch', dl.entries));
  for (const c of (s.commits || [])) hits.push(...scanText(c, 'commit', dl.entries));
  hits.push(...scanText(s.diff, 'diff', dl.entries));
  hits.push(...scanText(s.pr_title, 'pr_title', dl.entries));
  hits.push(...scanText(s.pr_body, 'pr_body', dl.entries));
  hits.push(...scanFiles(s.files));

  return { clean: hits.length === 0, denylist_loaded: dl.loaded, hits };
}

/** Gather the crossing surface from git (branch + commits-in-range + staged diff + files). */
function gatherFromGit(baseRef) {
  const git = (args) => {
    try { return execFileSync('git', args, { encoding: 'utf8' }); } catch { return ''; }
  };
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const range = baseRef ? `${baseRef}...HEAD` : 'HEAD';
  const commits = git(['log', '--format=%s%n%b', range]).split('\n').filter(Boolean);
  const diff = baseRef ? git(['diff', `${baseRef}...HEAD`]) : git(['diff', '--cached']);
  const files = git(['diff', '--name-only', baseRef ? `${baseRef}...HEAD` : '--cached'])
    .split('\n').map(s => s.trim()).filter(Boolean);
  return { branch, commits, diff, files };
}

function fail(msg) { process.stderr.write(`scrub: ${msg}\n`); process.exit(2); }

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dlFlagIdx = argv.indexOf('--denylist');
  const denylistPath = dlFlagIdx >= 0 ? argv[dlFlagIdx + 1] : undefined;

  let surface;
  if (argv[0] === '--git') {
    const base = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
    surface = gatherFromGit(base);
  } else if (argv[0] === 'scan') {
    let stdin = '';
    try { stdin = fs.readFileSync(0, 'utf8'); } catch {}
    try { surface = stdin.trim() ? JSON.parse(stdin) : {}; } catch { fail('invalid surface JSON on stdin'); }
  } else {
    fail('usage: scan (json on stdin) | --git [base] [--denylist <path>]');
  }

  const result = scanSurface(surface, { denylistPath });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.denylist_loaded) {
    process.stderr.write('scrub: WARNING — operator denylist not loaded (name-based scrubbing inactive); set CLAUDE_WORKFLOW_SCRUB_DENYLIST\n');
  }
  process.exit(result.clean ? 0 : 1);
}

module.exports = {
  scanText, scanFiles, scanSurface, gatherFromGit, loadDenylist,
  SECRET_PATTERNS, AI_CONTEXT_FILES, NEUTRAL_IPS, isNonRoutableOrDoc,
};
