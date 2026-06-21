#!/usr/bin/env node
/**
 * CLI: GitHub-issues queue adapter for the autonomous workflow driver.
 *
 * A single PRIVATE GitHub repo acts as the task queue — one issue = one task;
 * labels encode the state machine; comments are the progress log. The control
 * repo is NEVER a source constant: resolve it at runtime via `controlRepo()`.
 *
 * Exports (pure / unit-testable):
 *   parseTaskSpec(markdown)     → { target_repo, description, acceptance_criteria, constraints, priority }
 *   formatTaskBody(spec)        → markdown body (inverse of parse; round-trips)
 *   LABELS                      → state-machine label set
 *   nextLabel(current, event)   → next label string or throws on invalid transition
 *   buildGhArgs(op, ...)        → argv array for a gh CLI call (unit-test without network)
 *   controlRepo(opts)           → resolved repo string or throws
 *
 * gh-backed ops (thin wrappers around buildGhArgs + execFileSync):
 *   listQueued(repo)
 *   readTask(repo, n)
 *   transition(repo, n, fromLabel, toLabel)
 *   comment(repo, n, body)
 *   closeDone(repo, n)
 *   reopen(repo, n)
 *
 * Usage:
 *   node lib/queue-cli.js list [--repo owner/name]
 *   node lib/queue-cli.js read <number> [--repo owner/name]
 *   node lib/queue-cli.js transition <number> <fromLabel> <toLabel> [--repo owner/name]
 *   node lib/queue-cli.js comment <number> <body> [--repo owner/name]
 *   node lib/queue-cli.js close <number> [--repo owner/name]
 *   node lib/queue-cli.js reopen <number> [--repo owner/name]
 */
'use strict';

const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// State-machine label vocabulary
// ---------------------------------------------------------------------------

/** All valid queue labels. */
const LABELS = Object.freeze({
  QUEUED:            'queued',
  IN_PROGRESS:       'in-progress',
  SCRUB_PENDING:     'scrub-pending',
  REVIEW:            'review',
  DONE:              'done',
  BLOCKED:           'blocked',
  SCRUB_FAILED:      'scrub-failed',
  CHANGES_REQUESTED: 'changes-requested',
});

/**
 * Valid state-machine transitions: { [currentLabel]: { [event]: nextLabel } }.
 * Events are driver-defined verbs; unknown (current, event) pairs throw.
 */
const TRANSITIONS = Object.freeze({
  [LABELS.QUEUED]: {
    pick:   LABELS.IN_PROGRESS,
    block:  LABELS.BLOCKED,
  },
  [LABELS.IN_PROGRESS]: {
    scrub:   LABELS.SCRUB_PENDING,
    block:   LABELS.BLOCKED,
    abandon: LABELS.QUEUED,
  },
  [LABELS.SCRUB_PENDING]: {
    approve:     LABELS.REVIEW,
    fail:        LABELS.SCRUB_FAILED,
    in_progress: LABELS.IN_PROGRESS,  // scrub asked for more changes
  },
  [LABELS.REVIEW]: {
    approve:           LABELS.DONE,
    request_changes:   LABELS.CHANGES_REQUESTED,
    block:             LABELS.BLOCKED,
  },
  [LABELS.CHANGES_REQUESTED]: {
    resume:  LABELS.IN_PROGRESS,
    block:   LABELS.BLOCKED,
  },
  [LABELS.SCRUB_FAILED]: {
    resume:  LABELS.IN_PROGRESS,
    abandon: LABELS.QUEUED,
  },
  [LABELS.BLOCKED]: {
    unblock: LABELS.QUEUED,
  },
  [LABELS.DONE]: {
    // terminal — no valid transitions
  },
});

/**
 * Pure transition helper.
 * @param {string} current - current label value (e.g. 'queued')
 * @param {string} event   - transition event verb (e.g. 'pick')
 * @returns {string} next label
 * @throws {Error} on unknown label or invalid event for that label
 */
function nextLabel(current, event) {
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, current)) {
    throw new Error(`nextLabel: unknown current label "${current}"`);
  }
  const map = TRANSITIONS[current];
  if (!Object.prototype.hasOwnProperty.call(map, event)) {
    const valid = Object.keys(map).join(', ') || '(none — terminal state)';
    throw new Error(`nextLabel: invalid event "${event}" for label "${current}". Valid events: ${valid}`);
  }
  return map[event];
}

// ---------------------------------------------------------------------------
// Issue-body template parser / formatter
// ---------------------------------------------------------------------------

/**
 * The canonical issue-body template this adapter uses. Sections are
 * delimited by headings so they survive GitHub's rich-text editor intact.
 *
 * Template (informational; see SKILL.md for the authoritative copy):
 *
 *   ## Target Repo
 *   owner/repo-name
 *
 *   ## Description
 *   One-paragraph summary of what must be done.
 *
 *   ## Acceptance Criteria
 *   - [ ] First criterion
 *   - [ ] Second criterion
 *
 *   ## Constraints
 *   - No breaking changes to public API
 *
 *   ## Priority
 *   high
 *
 * Recognised priority values (case-insensitive): critical, high, medium, low.
 * Defaults to "medium" if the section is absent or unrecognised.
 */
const VALID_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const DEFAULT_PRIORITY = 'medium';

/**
 * Split a markdown document into a map of { lowercased-heading → trimmed-content }.
 * Handles H2 sections (`## Heading`) only; ignores leading prose before the first heading.
 */
function parseSections(markdown) {
  const map = Object.create(null);
  // Split on lines that start with "## " — each part begins with the heading text.
  const parts = String(markdown || '').split(/^## /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase();
    const content = nl === -1 ? '' : part.slice(nl + 1).trim();
    map[heading] = content;
  }
  return map;
}

/**
 * Parse checklist / bullet items from a section body.
 * Strips `- [ ]`, `- [x]`, `-`, and `*` prefixes.
 * Returns an array of non-empty strings.
 */
function parseListItems(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s*\[[ xX]\]\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Parse a task-spec from a GitHub issue body written using the canonical template.
 *
 * @param {string} issueBodyMarkdown
 * @returns {{ target_repo: string|null, description: string|null,
 *             acceptance_criteria: string[], constraints: string[], priority: string,
 *             _parse_errors: string[] }}
 */
function parseTaskSpec(issueBodyMarkdown) {
  const sections = parseSections(issueBodyMarkdown);
  const errors = [];

  const target_repo_raw = sections['target repo'] || null;
  const target_repo = target_repo_raw ? target_repo_raw.split('\n')[0].trim() : null;
  if (!target_repo) errors.push('Missing or empty "Target Repo" section');
  // Validate owner/repo shape
  if (target_repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target_repo)) {
    errors.push(`"Target Repo" value "${target_repo}" does not look like owner/repo`);
  }

  const description_raw = sections['description'] || null;
  const description = description_raw || null;
  if (!description) errors.push('Missing or empty "Description" section');

  const acceptance_criteria = parseListItems(sections['acceptance criteria'] || null);

  const constraints = parseListItems(sections['constraints'] || null);

  const priority_candidate = (sections['priority'] || '').split('\n')[0].trim().toLowerCase();
  const priority = VALID_PRIORITIES.has(priority_candidate) ? priority_candidate : DEFAULT_PRIORITY;

  return { target_repo, description, acceptance_criteria, constraints, priority, _parse_errors: errors };
}

/**
 * Render a task spec back into the canonical issue-body markdown.
 * Round-trips cleanly with parseTaskSpec for valid specs.
 *
 * @param {{ target_repo: string, description: string,
 *           acceptance_criteria?: string[], constraints?: string[], priority?: string }} spec
 * @returns {string}
 */
function formatTaskBody(spec) {
  const s = spec || {};
  const ac = Array.isArray(s.acceptance_criteria) ? s.acceptance_criteria : [];
  const co = Array.isArray(s.constraints) ? s.constraints : [];
  const priority = VALID_PRIORITIES.has((s.priority || '').toLowerCase())
    ? s.priority.toLowerCase()
    : DEFAULT_PRIORITY;

  const acLines = ac.length
    ? ac.map(c => `- [ ] ${c}`).join('\n')
    : '- [ ] (none specified)';

  const coLines = co.length
    ? co.map(c => `- ${c}`).join('\n')
    : '- (none)';

  return [
    '## Target Repo',
    String(s.target_repo || ''),
    '',
    '## Description',
    String(s.description || ''),
    '',
    '## Acceptance Criteria',
    acLines,
    '',
    '## Constraints',
    coLines,
    '',
    '## Priority',
    priority,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Control-repo resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the control (queue) repo from CLI opts or environment.
 *
 * @param {{ repo?: string }} opts
 * @returns {string} e.g. "owner/autopilot-queue"
 * @throws {Error} if neither opts.repo nor CLAUDE_WORKFLOW_CONTROL_REPO is set
 */
function controlRepo(opts) {
  const o = opts || {};
  const repo = o.repo || process.env.CLAUDE_WORKFLOW_CONTROL_REPO;
  if (!repo || !repo.trim()) {
    throw new Error(
      'Queue control repo is not configured. ' +
      'Set the CLAUDE_WORKFLOW_CONTROL_REPO environment variable (e.g. owner/autopilot-queue) ' +
      'or pass --repo <owner/repo> on the command line.'
    );
  }
  return repo.trim();
}

// ---------------------------------------------------------------------------
// gh CLI argument builders (pure — unit-testable without network)
// ---------------------------------------------------------------------------

/**
 * Build the argv array for a `gh` invocation.
 *
 * @param {'list'|'read'|'add-label'|'remove-label'|'comment'|'close'|'reopen'} op
 * @param {object} params
 * @returns {string[]} argv passed to execFileSync('gh', argv)
 */
function buildGhArgs(op, params) {
  const p = params || {};
  switch (op) {
    case 'list':
      // gh issue list --repo <repo> --label queued --state open --json number,title,body,labels
      return [
        'issue', 'list',
        '--repo', p.repo,
        '--label', p.label || LABELS.QUEUED,
        '--state', 'open',
        '--json', 'number,title,body,labels',
      ];

    case 'read':
      // gh issue view <number> --repo <repo> --json number,title,body,labels,comments
      return [
        'issue', 'view', String(p.number),
        '--repo', p.repo,
        '--json', 'number,title,body,labels,comments',
      ];

    case 'add-label':
      // gh issue edit <number> --repo <repo> --add-label <label>
      return [
        'issue', 'edit', String(p.number),
        '--repo', p.repo,
        '--add-label', p.label,
      ];

    case 'remove-label':
      // gh issue edit <number> --repo <repo> --remove-label <label>
      return [
        'issue', 'edit', String(p.number),
        '--repo', p.repo,
        '--remove-label', p.label,
      ];

    case 'comment':
      // gh issue comment <number> --repo <repo> --body <body>
      return [
        'issue', 'comment', String(p.number),
        '--repo', p.repo,
        '--body', p.body,
      ];

    case 'close':
      // gh issue close <number> --repo <repo> --reason completed
      return [
        'issue', 'close', String(p.number),
        '--repo', p.repo,
        '--reason', 'completed',
      ];

    case 'reopen':
      // gh issue reopen <number> --repo <repo>
      return [
        'issue', 'reopen', String(p.number),
        '--repo', p.repo,
      ];

    default:
      throw new Error(`buildGhArgs: unknown op "${op}"`);
  }
}

// ---------------------------------------------------------------------------
// gh-backed ops (thin wrappers — NOT unit-tested with live calls)
// ---------------------------------------------------------------------------

function gh(argv) {
  return JSON.parse(execFileSync('gh', argv, { encoding: 'utf8' }));
}

function ghVoid(argv) {
  execFileSync('gh', argv, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** List all open issues labelled 'queued'. */
function listQueued(repo) {
  return gh(buildGhArgs('list', { repo, label: LABELS.QUEUED }));
}

/** Fetch a single issue (with body, labels, comments). */
function readTask(repo, number) {
  return gh(buildGhArgs('read', { repo, number }));
}

/**
 * Transition an issue from fromLabel → toLabel by swapping the label.
 * We remove the old label then add the new one. Idempotent on the add side.
 */
function transition(repo, number, fromLabel, toLabel) {
  // Validate the transition first (throws on invalid)
  // We accept any event that produces toLabel from fromLabel, so we verify directly:
  const validNextLabels = Object.values(TRANSITIONS[fromLabel] || {});
  if (!validNextLabels.includes(toLabel)) {
    throw new Error(
      `transition: "${toLabel}" is not a valid next state from "${fromLabel}". ` +
      `Valid next states: ${validNextLabels.join(', ') || '(none — terminal state)'}`
    );
  }
  ghVoid(buildGhArgs('remove-label', { repo, number, label: fromLabel }));
  ghVoid(buildGhArgs('add-label',    { repo, number, label: toLabel }));
}

/** Post a progress comment on an issue. */
function comment(repo, number, body) {
  ghVoid(buildGhArgs('comment', { repo, number, body }));
}

/** Close an issue as completed (used when transitioning to 'done'). */
function closeDone(repo, number) {
  ghVoid(buildGhArgs('close', { repo, number }));
}

/** Reopen a closed issue. */
function reopen(repo, number) {
  ghVoid(buildGhArgs('reopen', { repo, number }));
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

function fail(msg) { process.stderr.write(`queue: ${msg}\n`); process.exit(2); }

if (require.main === module) {
  const argv = process.argv.slice(2);

  // Parse --repo flag anywhere in argv
  const repoIdx = argv.indexOf('--repo');
  const repoFlag = repoIdx >= 0 ? argv[repoIdx + 1] : undefined;
  const opts = { repo: repoFlag };

  let repo;
  try { repo = controlRepo(opts); } catch (e) { fail(e.message); }

  const cmd = argv[0];
  try {
    switch (cmd) {
      case 'list':
      case 'listQueued': {
        const result = listQueued(repo);
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        break;
      }
      case 'read':
      case 'readTask': {
        const n = parseInt(argv[1], 10);
        if (!n) fail('usage: read <number> [--repo owner/name]');
        const result = readTask(repo, n);
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        break;
      }
      case 'transition': {
        const n = parseInt(argv[1], 10);
        const from = argv[2];
        const to   = argv[3];
        if (!n || !from || !to) fail('usage: transition <number> <fromLabel> <toLabel> [--repo owner/name]');
        transition(repo, n, from, to);
        process.stdout.write(JSON.stringify({ ok: true, number: n, from, to }) + '\n');
        break;
      }
      case 'comment': {
        const n = parseInt(argv[1], 10);
        const body = argv[2];
        if (!n || !body) fail('usage: comment <number> <body> [--repo owner/name]');
        comment(repo, n, body);
        process.stdout.write(JSON.stringify({ ok: true, number: n }) + '\n');
        break;
      }
      case 'close': {
        const n = parseInt(argv[1], 10);
        if (!n) fail('usage: close <number> [--repo owner/name]');
        closeDone(repo, n);
        process.stdout.write(JSON.stringify({ ok: true, number: n }) + '\n');
        break;
      }
      case 'reopen': {
        const n = parseInt(argv[1], 10);
        if (!n) fail('usage: reopen <number> [--repo owner/name]');
        reopen(repo, n);
        process.stdout.write(JSON.stringify({ ok: true, number: n }) + '\n');
        break;
      }
      default:
        fail('usage: list | read <n> | transition <n> <from> <to> | comment <n> <body> | close <n> | reopen <n>');
    }
  } catch (e) {
    fail(e.message);
  }
}

module.exports = {
  LABELS,
  TRANSITIONS,
  nextLabel,
  parseTaskSpec,
  formatTaskBody,
  controlRepo,
  buildGhArgs,
  // gh-backed ops
  listQueued,
  readTask,
  transition,
  comment,
  closeDone,
  reopen,
};
