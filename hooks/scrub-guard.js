#!/usr/bin/env node
/**
 * Scrub gate — PreToolUse interceptor (the plugin's first PreToolUse hook).
 *
 * Makes the scrub gate UNBYPASSABLE: before any tool call that publishes to a
 * remote git repo, if the target repo is NOT private it gathers the crossing
 * surface (branch, commits, diff, PR title/body, files) and runs the scrub
 * marker engine (lib/scrub-cli.js). Any internal-info marker → DENY the tool.
 *
 * Intercepts:
 *   - Bash:  `git push …`  and  `gh pr create …`
 *   - MCP:   mcp__github__{create_pull_request, push_files, create_or_update_file, create_branch}
 *
 * Safety posture (a leak to a public repo is permanent):
 *   - Confirmed PRIVATE target → allow (internal info in your own private repo is fine).
 *   - PUBLIC / INTERNAL / UNKNOWN visibility → scrub; clean → allow, markers → DENY.
 *   - On an internal error during a publish action → DENY (fail closed).
 *   - Forward-hygiene only: this BLOCKS the new write; it never rewrites history.
 *
 * Non-publish tool calls pass straight through (exit 0, silent). The hook never
 * GRANTS permission it shouldn't — it only ever denies; normal permission flow
 * continues for everything it allows.
 */

'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { scanSurface } = require('../lib/scrub-cli');

const MCP_PUBLISH = new Set([
  'mcp__github__create_pull_request',
  'mcp__github__push_files',
  'mcp__github__create_or_update_file',
  'mcp__github__create_branch',
]);

/**
 * Classify a tool call. Returns { publish, kind, repoSlug?, hints? }.
 * Pure — no git/gh, so it's unit-testable.
 */
function classifyTool(toolName, toolInput) {
  const ti = toolInput || {};
  if (toolName === 'Bash') {
    const cmd = String(ti.command || '');
    if (/\bgit\s+push\b/.test(cmd)) return { publish: true, kind: 'git-push' };
    if (/\bgh\s+pr\s+create\b/.test(cmd)) {
      return {
        publish: true, kind: 'gh-pr',
        repoSlug: argValue(cmd, '--repo') || argValue(cmd, '-R'),
        hints: { pr_title: argValue(cmd, '--title') || argValue(cmd, '-t'),
                 pr_body: argValue(cmd, '--body') || argValue(cmd, '-b') },
      };
    }
    return { publish: false };
  }
  if (MCP_PUBLISH.has(toolName)) {
    const repoSlug = ti.owner && ti.repo ? `${ti.owner}/${ti.repo}` : null;
    const hints = {
      pr_title: ti.title, pr_body: ti.body, branch: ti.head || ti.branch,
      // file-write tools: fold provided content/message/paths into the surface
      diff: [ti.message, ti.content, JSON.stringify(ti.files || '')].filter(Boolean).join('\n'),
      files: Array.isArray(ti.files) ? ti.files.map(f => f.path || f) : (ti.path ? [ti.path] : []),
    };
    return { publish: true, kind: 'mcp', repoSlug, hints };
  }
  return { publish: false };
}

/** Extract `--flag value` or `--flag=value` (quote-aware enough for our use). */
function argValue(cmd, flag) {
  const eq = new RegExp(`${flag}=(?:"([^"]*)"|'([^']*)'|(\\S+))`);
  const sp = new RegExp(`${flag}\\s+(?:"([^"]*)"|'([^']*)'|(\\S+))`);
  const m = cmd.match(eq) || cmd.match(sp);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/**
 * Decide allow/deny from a gathered surface + resolved visibility.
 * Pure — unit-testable. visibility: 'PRIVATE' | 'PUBLIC' | 'INTERNAL' | null.
 * Returns { decision: 'allow'|'deny', reason?, hits? }.
 */
function decide(surface, visibility, scanOpts) {
  if (String(visibility).toUpperCase() === 'PRIVATE') {
    return { decision: 'allow', reason: 'target repo is private' };
  }
  const result = scanSurface(surface, scanOpts || {});
  if (result.clean) return { decision: 'allow' };
  return { decision: 'deny', hits: result.hits, denylist_loaded: result.denylist_loaded };
}

// ---- live git/gh helpers (used only in main, not in tests) -----------------

function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

function resolveVisibility(repoSlug, cwd) {
  try {
    const args = ['repo', 'view', '--json', 'visibility,isPrivate,nameWithOwner'];
    if (repoSlug) args.splice(2, 0, repoSlug);
    const out = execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out).visibility || null;
  } catch {
    return null; // unknown → treated as scrub-required by decide()
  }
}

function gatherPushSurface(cwd, hints) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
  let base = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd).trim();
  if (!base) {
    for (const c of ['origin/main', 'origin/master', 'main', 'master']) {
      if (git(['rev-parse', '--verify', '--quiet', c], cwd).trim()) { base = c; break; }
    }
  }
  const range = base ? `${base}..HEAD` : 'HEAD';
  const commits = git(['log', '--format=%s%n%b', range], cwd).split('\n').filter(Boolean);
  const diff = git(['diff', range], cwd) || git(['diff', 'HEAD'], cwd);
  const files = git(['diff', '--name-only', range], cwd).split('\n').map(s => s.trim()).filter(Boolean);
  return { branch, commits, diff, files, ...(hints || {}) };
}

function denyOutput(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

if (require.main === module) {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
  const cwd = input.cwd || process.cwd();
  const cls = classifyTool(input.tool_name, input.tool_input);

  if (!cls.publish) process.exit(0); // not a publish action — pass through

  try {
    const visibility = resolveVisibility(cls.repoSlug, cwd);
    if (String(visibility).toUpperCase() === 'PRIVATE') process.exit(0); // private → allow

    const surface = cls.kind === 'mcp'
      ? Object.assign(gatherPushSurface(cwd), cls.hints)
      : gatherPushSurface(cwd, cls.hints);

    const verdict = decide(surface, visibility);
    if (verdict.decision === 'deny') {
      const where = verdict.hits.map(h => `${h.category}@${h.where}:${h.match}`).join(', ');
      const note = verdict.denylist_loaded ? '' : ' (operator denylist NOT loaded — only structural markers checked; set CLAUDE_WORKFLOW_SCRUB_DENYLIST)';
      process.stdout.write(denyOutput(
        `Scrub gate BLOCKED a write to a non-private repo (visibility=${visibility || 'unknown'}). ` +
        `Internal markers found: ${where}.${note} Fix the content (genericize/redact) or push to a private repo. ` +
        `Forward-hygiene only — do NOT history-rewrite.`));
      process.exit(0);
    }
    process.exit(0); // clean → allow
  } catch (err) {
    // Fail closed on a publish action — a leak is unrecoverable.
    process.stdout.write(denyOutput(`Scrub gate errored (${err && err.message}); blocking the publish to be safe. Re-run after fixing tooling, or push to a private repo.`));
    process.exit(0);
  }
}

module.exports = { classifyTool, decide, argValue, MCP_PUBLISH };
