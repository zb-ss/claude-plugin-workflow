#!/usr/bin/env node
/**
 * Scrub gate — PreToolUse interceptor. Before a tool call that publishes to a
 * remote (Bash `git push`, `gh pr create`; MCP GitHub writes) to a repo that is
 * not private, it scans the crossing surface with lib/scrub-cli.js and denies
 * on any internal-info marker. Unknown visibility is scanned; an internal error
 * on a publish fails closed. It only ever denies; it never rewrites history.
 *
 * Which repository: `cd <dir> && git push …`, `cd <dir> && gh pr create …` and
 * `git -C <dir> push …` are scanned in <dir>. Any other cd, -C, --git-dir,
 * --work-tree or GIT_DIR= in a publish command is denied, and so is an unquoted
 * publish chained with other commands, because the text scanned must be the
 * text that runs. A command that only quotes the phrase is checked in the cwd.
 * No shell parsing is attempted.
 *
 * Autonomous driver runs (CLAUDE_WORKFLOW_DRIVER_WAKE_PID set) are limited to
 * an allowlist: a non-default-branch push and a plain pull request.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanSurface } = require('../lib/scrub-cli');

const MCP_PUBLISH = new Set([
  'mcp__github__create_pull_request',
  'mcp__github__push_files',
  'mcp__github__create_or_update_file',
  'mcp__github__create_branch',
]);

// A quoted or bare word. A git push is matched anywhere in the text so pushes
// inside heredocs, pipes and wrappers stay detected.
const WORD = '"[^"]*"|\'[^\']*\'|\\S+';
// Any run of git global options may sit between `git` and `push`.
const GIT_OPT = `-[cC]\\s+(?:${WORD})|--(?:git-dir|work-tree|namespace|exec-path)(?:=\\S+|\\s+(?:${WORD}))|--?[A-Za-z][\\w-]*(?:=\\S+)?`;
const GIT_PUSH = new RegExp(`\\bgit(?:\\s+(?:${GIT_OPT}))*\\s+push\\b`);
const UNSAFE_CHARS = /&&|\|\||;|\||\n|\$\(|`/;
// Anything in the raw text that can move a push to another repository.
const RELOCATION = /\bcd\b|\bpushd\b|(?:^|\s)-C\s|--git-dir\b|--work-tree\b|\bGIT_(?:DIR|WORK_TREE)=/;

const DRIVER_HELP = 'Scrub gate: in an autonomous driver run, publish only as: ' +
  'cd "<repo>" && git push -u origin <branch>, or ' +
  'cd "<repo>" && gh pr create --title ... --body-file <file>';
const NO_DIR_REASON = 'Scrub gate cannot tell which repository this push runs in; ' +
  'run it as one command: cd "<absolute path>" && git push ...';
const BODY_REASON = 'Scrub gate cannot tell what this pull request command publishes; ' +
  'run it as one command without chaining or substitution, and pass a multi-line body ' +
  'with --body-file <file> written in an earlier step';

/**
 * Classify a tool call. Returns { publish, kind, repoSlug?, hints?, bodyFile? }.
 * Pure — no git/gh, so it's unit-testable.
 */
function classifyTool(toolName, toolInput) {
  const ti = toolInput || {};
  if (toolName === 'Bash') {
    const cmd = String(ti.command || '');
    // gh pr create first: its text may mention a push and must still be scanned.
    if (/\bgh\s+pr\s+create\b/.test(cmd)) {
      return {
        publish: true, kind: 'gh-pr',
        repoSlug: argValue(cmd, '--repo') || argValue(cmd, '-R'),
        hints: { pr_title: argValue(cmd, '--title') || argValue(cmd, '-t'),
                 pr_body: argValue(cmd, '--body') || argValue(cmd, '-b') },
        bodyFile: argValue(cmd, '--body-file') || argValue(cmd, '-F'),
      };
    }
    if (GIT_PUSH.test(cmd)) return { publish: true, kind: 'git-push' };
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

function unquote(word) {
  return /^(["']).*\1$/.test(word) ? word.slice(1, -1) : word;
}

/**
 * Directory a publish command runs in, found without parsing shell.
 * Returns { ok: true, dir } (dir null = the hook's cwd) or { ok: false }.
 */
function commandDir(cmd) {
  const t = String(cmd || '').trim();
  // Quoted text may hold newlines, `;` or `|`; it is blanked unless it substitutes.
  const unsafe = text => UNSAFE_CHARS.test(blankQuoted(text));
  const reason = /\bgh\s+pr\s+create\b/.test(t) ? BODY_REASON : NO_DIR_REASON;
  const cd = t.match(new RegExp(`^cd\\s+(${WORD})\\s+&&\\s+((?:git\\s+push|gh\\s+pr\\s+create)\\b[\\s\\S]*)$`));
  if (cd) return unsafe(cd[2]) ? { ok: false, reason } : { ok: true, dir: unquote(cd[1]) };
  const dashC = t.match(new RegExp(`^git\\s+-C\\s+(${WORD})\\s+push\\b`));
  if (dashC) return unsafe(t) ? { ok: false, reason } : { ok: true, dir: unquote(dashC[1]) };
  // Anything else that could move the push to another repository is refused.
  if (RELOCATION.test(t)) return { ok: false, reason: NO_DIR_REASON };
  // A real (unquoted) publish chained with other commands could push work the
  // hook never sees, so it is refused. A phrase that sits only inside quotes
  // (a grep pattern, a commit message) is still checked, in the cwd as before.
  const bare = blankQuoted(t);
  const unquoted = GIT_PUSH.test(bare) || /\bgh\s+pr\s+create\b/.test(bare);
  if (unquoted && unsafe(t)) return { ok: false, reason };
  return { ok: true, dir: null };
}

function blankQuoted(text) {
  return text.replace(/'[^']*'|"[^"]*"/g, quoted => {
    if (quoted[0] === "'") return "''";
    // A heredoc body (`$(cat <<...`) is plain text and is scanned with the command.
    return /`|\$\((?!cat\s+<<)/.test(quoted) ? quoted : '""';
  });
}

/** Resolve a command directory against cwd; null when unsafe or not a directory. */
function resolveDir(raw, cwd) {
  if (/[$`]/.test(raw)) return null;
  const home = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
  const dir = path.resolve(cwd, home);
  try { return fs.statSync(dir).isDirectory() ? dir : null; } catch { return null; }
}

// ---- autonomous driver allowlist -------------------------------------------

const REF_NAME = /^(?!-)[A-Za-z0-9._\/-]+$/;
const PR_FLAG = new RegExp(
  '^\\s+(?:(--title|-t|--body|-b|--body-file|-F|--base|-B|--head|-H|--repo|-R)(?:=|\\s+)' +
  '("[^"]*"|\'[^\']*\'|[A-Za-z0-9._\\/:@#,+~-]+)|(--draft|-d)(?=\\s|$))');

/** Short branch name of a pushed ref; null for an unresolvable HEAD or a non-branch ref. */
function pushedBranch(ref, repo) {
  const name = ref === 'HEAD' || ref === '@' ? (repo.currentBranch ? repo.currentBranch() : '') : ref;
  if (!name || name === 'HEAD' || /^refs\/(?!heads\/)/.test(name)) return null;
  return name.replace(/^(?:refs\/)?heads\//, '');
}

function driverPushDenial(cmd, defaultBranchOf, repo) {
  const m = cmd.match(new RegExp(
    `^cd\\s+(?:${WORD})\\s+&&\\s+git\\s+push(?:\\s+(?:-u|--set-upstream))?\\s+(\\S+)\\s+(\\S+)$`));
  if (!m || !REF_NAME.test(m[1]) || !REF_NAME.test(m[2])) return DRIVER_HELP;
  const branch = pushedBranch(m[2], repo);
  // A name that is not a local branch could be a tag; tags are not pushed here.
  if (!branch || (repo.hasBranch && !repo.hasBranch(branch))) return DRIVER_HELP;
  const known = defaultBranchOf(m[1]);
  const is_default = branch === known || /^(main|master)$/.test(branch);
  return is_default
    ? `Scrub gate: an autonomous driver run may not push to the default branch (${branch})`
    : null;
}

function driverPrDenial(cmd) {
  const m = cmd.match(new RegExp(`^cd\\s+(?:${WORD})\\s+&&\\s+gh\\s+pr\\s+create([\\s\\S]*)$`));
  if (!m) return DRIVER_HELP;
  let rest = m[1];
  while (rest) {
    const flag = PR_FLAG.exec(rest);
    // A $ or backtick in any value would be expanded by the shell.
    if (!flag || (flag[2] && /[$`]/.test(flag[2]))) return DRIVER_HELP;
    rest = rest.slice(flag[0].length);
  }
  return null;
}

/**
 * Allowlist for autonomous driver runs. Returns a deny reason or null.
 * defaultBranchOf(remote) returns the remote's default branch or null;
 * repo optionally offers currentBranch() and hasBranch(name).
 */
function driverDenial(cls, cmd, defaultBranchOf, repo) {
  const t = String(cmd || '').trim();
  if (cls.kind === 'git-push') return driverPushDenial(t, defaultBranchOf, repo || {});
  if (cls.kind === 'gh-pr') return driverPrDenial(t);
  return DRIVER_HELP;
}

/** Read a --body-file value. Returns { ok: true, text } or { ok: false }. */
function readBodyFile(value, dir) {
  if (value === '-' || /[$`]|<\(/.test(value)) return { ok: false };
  try { return { ok: true, text: fs.readFileSync(path.resolve(dir, unquote(value)), 'utf8') }; }
  catch { return { ok: false }; }
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
  return { decision: 'deny', hits: result.hits, denylist_loaded: result.denylist_loaded, denylist_status: result.denylist_status };
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

function remoteDefaultBranch(remote, dir) {
  const ref = git(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], dir).trim();
  return ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : null;
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

/** Returns { dir } or { deny } for a Bash publish command. */
function locate(cmd, cwd) {
  const found = commandDir(cmd);
  if (!found.ok) return { deny: found.reason };
  if (found.dir === null) return { dir: cwd };
  const dir = resolveDir(found.dir, cwd);
  return dir ? { dir } : { deny: NO_DIR_REASON };
}

/** Fold the --body-file text and the full command text into pr_body. */
function withBodyText(cls, cmd, dir) {
  const parts = [cls.hints.pr_body];
  if (cls.bodyFile) {
    const file = readBodyFile(cls.bodyFile, dir);
    if (!file.ok) {
      return `Scrub gate cannot read the pull request body (${cls.bodyFile}); ` +
        'pass it as a literal --body argument or a plain file path';
    }
    parts.push(file.text);
  }
  parts.push(cmd); // covers a heredoc body without parsing it
  cls.hints.pr_body = parts.filter(Boolean).join('\n');
  return null;
}

function scrubReason(verdict, visibility) {
  const where = verdict.hits.map(h => `${h.category}@${h.where}:${h.match}`).join(', ');
  const note = verdict.denylist_loaded ? ''
    : verdict.denylist_status === 'unreadable'
      ? ' (configured denylist path not readable — only structural markers checked; fix CLAUDE_WORKFLOW_SCRUB_DENYLIST)'
      : ' (operator denylist NOT loaded — only structural markers checked; set CLAUDE_WORKFLOW_SCRUB_DENYLIST)';
  return `Scrub gate BLOCKED a write to a non-private repo (visibility=${visibility || 'unknown'}). ` +
    `Internal markers found: ${where}.${note} Fix the content (genericize/redact) or push to a private repo. ` +
    'Forward-hygiene only — do NOT history-rewrite.';
}

/** Returns a deny reason, or null to allow. */
function run(input) {
  const cwd = input.cwd || process.cwd();
  const cls = classifyTool(input.tool_name, input.tool_input);
  if (!cls.publish) return null; // not a publish action — pass through

  const cmd = String((input.tool_input || {}).command || '');
  let dir = cwd;
  if (cls.kind !== 'mcp') {
    const where = locate(cmd, cwd);
    if (where.deny) return where.deny;
    dir = where.dir;
  }
  if (process.env.CLAUDE_WORKFLOW_DRIVER_WAKE_PID) {
    const repo = {
      currentBranch: () => git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim(),
      hasBranch: name => git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], dir).trim() !== '',
    };
    const denial = driverDenial(cls, cmd, remote => remoteDefaultBranch(remote, dir), repo);
    if (denial) return denial;
  }
  if (cls.kind === 'gh-pr') {
    const denial = withBodyText(cls, cmd, dir);
    if (denial) return denial;
  }

  const visibility = resolveVisibility(cls.repoSlug, dir);
  if (String(visibility).toUpperCase() === 'PRIVATE') return null; // private → allow

  const surface = cls.kind === 'mcp'
    ? Object.assign(gatherPushSurface(dir), cls.hints)
    : gatherPushSurface(dir, cls.hints);
  const verdict = decide(surface, visibility);
  return verdict.decision === 'deny' ? scrubReason(verdict, visibility) : null;
}

if (require.main === module) {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
  try {
    const reason = run(input);
    if (reason) process.stdout.write(denyOutput(reason));
  } catch (err) {
    // Fail closed on a publish action — a leak is unrecoverable.
    process.stdout.write(denyOutput(`Scrub gate errored (${err && err.message}); blocking the publish to be safe. Re-run after fixing tooling, or push to a private repo.`));
  }
  process.exit(0);
}

module.exports = { classifyTool, decide, argValue, commandDir, driverDenial, MCP_PUBLISH };
