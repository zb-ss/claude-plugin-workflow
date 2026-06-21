/**
 * Tests for lib/queue-cli.js — the GitHub-issues queue adapter.
 *
 * Scope: pure functions only. No live gh CLI calls are made.
 *   - parseTaskSpec  (well-formed, missing fields, extra prose)
 *   - formatTaskBody (round-trip)
 *   - nextLabel      (valid transitions, terminal state, unknown label, invalid event)
 *   - buildGhArgs    (argv array for every op)
 *   - controlRepo    (env var, --repo flag, neither → throws)
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  LABELS,
  TRANSITIONS,
  nextLabel,
  parseTaskSpec,
  formatTaskBody,
  controlRepo,
  buildGhArgs,
} = require('../lib/queue-cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a canonical well-formed issue body from parts. */
function makeBody({
  target_repo = 'owner/my-repo',
  description = 'Implement the widget feature.',
  acceptance_criteria = ['Widget renders', 'Tests pass'],
  constraints = ['No breaking API changes'],
  priority = 'high',
} = {}) {
  const ac = acceptance_criteria.map(c => `- [ ] ${c}`).join('\n');
  const co = constraints.map(c => `- ${c}`).join('\n');
  return [
    '## Target Repo',
    target_repo,
    '',
    '## Description',
    description,
    '',
    '## Acceptance Criteria',
    ac,
    '',
    '## Constraints',
    co,
    '',
    '## Priority',
    priority,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// parseTaskSpec — well-formed input
// ---------------------------------------------------------------------------

describe('parseTaskSpec — well-formed', () => {
  it('parses target_repo correctly', () => {
    const spec = parseTaskSpec(makeBody({ target_repo: 'acme/backend' }));
    assert.equal(spec.target_repo, 'acme/backend');
    assert.deepEqual(spec._parse_errors, []);
  });

  it('parses description', () => {
    const spec = parseTaskSpec(makeBody({ description: 'Do something important.' }));
    assert.equal(spec.description, 'Do something important.');
  });

  it('parses acceptance_criteria as array (strips checkbox prefix)', () => {
    const spec = parseTaskSpec(makeBody({ acceptance_criteria: ['All tests green', 'Linter passes'] }));
    assert.deepEqual(spec.acceptance_criteria, ['All tests green', 'Linter passes']);
  });

  it('parses constraints as array (strips bullet prefix)', () => {
    const spec = parseTaskSpec(makeBody({ constraints: ['No TS changes', 'Must be backward-compat'] }));
    assert.deepEqual(spec.constraints, ['No TS changes', 'Must be backward-compat']);
  });

  it('parses priority: high', () => {
    const spec = parseTaskSpec(makeBody({ priority: 'high' }));
    assert.equal(spec.priority, 'high');
  });

  it('parses priority: critical', () => {
    const spec = parseTaskSpec(makeBody({ priority: 'critical' }));
    assert.equal(spec.priority, 'critical');
  });

  it('parses priority case-insensitively', () => {
    const spec = parseTaskSpec(makeBody({ priority: 'HIGH' }));
    assert.equal(spec.priority, 'high');
  });

  it('has no parse errors on a complete well-formed body', () => {
    const spec = parseTaskSpec(makeBody());
    assert.deepEqual(spec._parse_errors, []);
  });

  it('handles already-checked items [x] in acceptance_criteria', () => {
    const body = makeBody().replace('- [ ] Widget renders', '- [x] Widget renders');
    const spec = parseTaskSpec(body);
    assert.ok(spec.acceptance_criteria.includes('Widget renders'));
  });

  it('tolerates extra prose before the first section', () => {
    const body = 'Some introductory prose here.\n\nMore context.\n\n' + makeBody();
    const spec = parseTaskSpec(body);
    assert.equal(spec.target_repo, 'owner/my-repo');
    assert.deepEqual(spec._parse_errors, []);
  });

  it('tolerates extra prose after the last section', () => {
    const body = makeBody() + '\n\nSome trailing notes not in any section.';
    const spec = parseTaskSpec(body);
    assert.equal(spec.priority, 'high');
    assert.deepEqual(spec._parse_errors, []);
  });

  it('handles multi-line description', () => {
    const desc = 'Line one.\nLine two.\nLine three.';
    const spec = parseTaskSpec(makeBody({ description: desc }));
    assert.ok(spec.description.includes('Line one.'));
    assert.ok(spec.description.includes('Line three.'));
  });
});

// ---------------------------------------------------------------------------
// parseTaskSpec — missing / malformed fields
// ---------------------------------------------------------------------------

describe('parseTaskSpec — missing fields', () => {
  it('reports error when Target Repo is absent', () => {
    const body = makeBody().replace(/## Target Repo\n.*\n/, '');
    const spec = parseTaskSpec(body);
    assert.ok(spec._parse_errors.some(e => e.includes('Target Repo')));
    assert.equal(spec.target_repo, null);
  });

  it('reports error when Description is absent', () => {
    const body = makeBody().replace(/## Description\n.*\n/, '');
    const spec = parseTaskSpec(body);
    assert.ok(spec._parse_errors.some(e => e.includes('Description')));
  });

  it('defaults to empty array when Acceptance Criteria section is absent', () => {
    const body = makeBody().replace(/## Acceptance Criteria\n[\s\S]*?\n\n/, '');
    const spec = parseTaskSpec(body);
    assert.deepEqual(spec.acceptance_criteria, []);
  });

  it('defaults to empty array when Constraints section is absent', () => {
    const body = makeBody().replace(/## Constraints\n[\s\S]*?\n\n/, '');
    const spec = parseTaskSpec(body);
    assert.deepEqual(spec.constraints, []);
  });

  it('defaults priority to "medium" when Priority section is absent', () => {
    const body = makeBody().replace(/## Priority\nhigh/, '');
    const spec = parseTaskSpec(body);
    assert.equal(spec.priority, 'medium');
  });

  it('defaults priority to "medium" when priority value is unrecognised', () => {
    const body = makeBody({ priority: 'urgent' });
    const spec = parseTaskSpec(body);
    assert.equal(spec.priority, 'medium');
  });

  it('reports error when target_repo does not look like owner/repo', () => {
    const body = makeBody({ target_repo: 'not-a-valid-repo-string' });
    const spec = parseTaskSpec(body);
    assert.ok(spec._parse_errors.some(e => e.includes('owner/repo')));
  });

  it('handles completely empty string gracefully', () => {
    const spec = parseTaskSpec('');
    assert.equal(spec.target_repo, null);
    assert.equal(spec.description, null);
    assert.deepEqual(spec.acceptance_criteria, []);
    assert.deepEqual(spec.constraints, []);
    assert.equal(spec.priority, 'medium');
    assert.ok(spec._parse_errors.length >= 2);
  });

  it('handles null/undefined input gracefully', () => {
    assert.doesNotThrow(() => parseTaskSpec(null));
    assert.doesNotThrow(() => parseTaskSpec(undefined));
  });
});

// ---------------------------------------------------------------------------
// formatTaskBody — round-trip
// ---------------------------------------------------------------------------

describe('formatTaskBody — round-trip', () => {
  const CANONICAL_SPEC = {
    target_repo: 'owner/my-repo',
    description: 'Implement the widget feature.',
    acceptance_criteria: ['Widget renders', 'Tests pass'],
    constraints: ['No breaking API changes'],
    priority: 'high',
  };

  it('round-trips target_repo', () => {
    const body = formatTaskBody(CANONICAL_SPEC);
    const spec = parseTaskSpec(body);
    assert.equal(spec.target_repo, CANONICAL_SPEC.target_repo);
  });

  it('round-trips description', () => {
    const body = formatTaskBody(CANONICAL_SPEC);
    const spec = parseTaskSpec(body);
    assert.equal(spec.description, CANONICAL_SPEC.description);
  });

  it('round-trips acceptance_criteria', () => {
    const body = formatTaskBody(CANONICAL_SPEC);
    const spec = parseTaskSpec(body);
    assert.deepEqual(spec.acceptance_criteria, CANONICAL_SPEC.acceptance_criteria);
  });

  it('round-trips constraints', () => {
    const body = formatTaskBody(CANONICAL_SPEC);
    const spec = parseTaskSpec(body);
    assert.deepEqual(spec.constraints, CANONICAL_SPEC.constraints);
  });

  it('round-trips priority', () => {
    const body = formatTaskBody(CANONICAL_SPEC);
    const spec = parseTaskSpec(body);
    assert.equal(spec.priority, CANONICAL_SPEC.priority);
  });

  it('defaults empty acceptance_criteria to placeholder text (not errors)', () => {
    const body = formatTaskBody({ ...CANONICAL_SPEC, acceptance_criteria: [] });
    assert.ok(body.includes('(none specified)'));
  });

  it('defaults empty constraints to placeholder text', () => {
    const body = formatTaskBody({ ...CANONICAL_SPEC, constraints: [] });
    assert.ok(body.includes('(none)'));
  });

  it('defaults unknown priority to medium in output', () => {
    const body = formatTaskBody({ ...CANONICAL_SPEC, priority: 'bogus' });
    const spec = parseTaskSpec(body);
    assert.equal(spec.priority, 'medium');
  });

  it('produces all five expected section headings', () => {
    const body = formatTaskBody(CANONICAL_SPEC);
    for (const h of ['Target Repo', 'Description', 'Acceptance Criteria', 'Constraints', 'Priority']) {
      assert.ok(body.includes(`## ${h}`), `missing heading: ## ${h}`);
    }
  });

  it('is idempotent: format(parse(format(spec))) === format(spec)', () => {
    const body1 = formatTaskBody(CANONICAL_SPEC);
    const body2 = formatTaskBody(parseTaskSpec(body1));
    assert.equal(body1, body2);
  });
});

// ---------------------------------------------------------------------------
// nextLabel — state machine
// ---------------------------------------------------------------------------

describe('nextLabel — valid transitions', () => {
  it('queued + pick → in-progress', () => {
    assert.equal(nextLabel(LABELS.QUEUED, 'pick'), LABELS.IN_PROGRESS);
  });

  it('queued + block → blocked', () => {
    assert.equal(nextLabel(LABELS.QUEUED, 'block'), LABELS.BLOCKED);
  });

  it('in-progress + scrub → scrub-pending', () => {
    assert.equal(nextLabel(LABELS.IN_PROGRESS, 'scrub'), LABELS.SCRUB_PENDING);
  });

  it('in-progress + block → blocked', () => {
    assert.equal(nextLabel(LABELS.IN_PROGRESS, 'block'), LABELS.BLOCKED);
  });

  it('in-progress + abandon → queued', () => {
    assert.equal(nextLabel(LABELS.IN_PROGRESS, 'abandon'), LABELS.QUEUED);
  });

  it('scrub-pending + approve → review', () => {
    assert.equal(nextLabel(LABELS.SCRUB_PENDING, 'approve'), LABELS.REVIEW);
  });

  it('scrub-pending + fail → scrub-failed', () => {
    assert.equal(nextLabel(LABELS.SCRUB_PENDING, 'fail'), LABELS.SCRUB_FAILED);
  });

  it('scrub-pending + in_progress → in-progress (re-work loop)', () => {
    assert.equal(nextLabel(LABELS.SCRUB_PENDING, 'in_progress'), LABELS.IN_PROGRESS);
  });

  it('review + approve → done', () => {
    assert.equal(nextLabel(LABELS.REVIEW, 'approve'), LABELS.DONE);
  });

  it('review + request_changes → changes-requested', () => {
    assert.equal(nextLabel(LABELS.REVIEW, 'request_changes'), LABELS.CHANGES_REQUESTED);
  });

  it('review + block → blocked', () => {
    assert.equal(nextLabel(LABELS.REVIEW, 'block'), LABELS.BLOCKED);
  });

  it('changes-requested + resume → in-progress', () => {
    assert.equal(nextLabel(LABELS.CHANGES_REQUESTED, 'resume'), LABELS.IN_PROGRESS);
  });

  it('changes-requested + block → blocked', () => {
    assert.equal(nextLabel(LABELS.CHANGES_REQUESTED, 'block'), LABELS.BLOCKED);
  });

  it('scrub-failed + resume → in-progress', () => {
    assert.equal(nextLabel(LABELS.SCRUB_FAILED, 'resume'), LABELS.IN_PROGRESS);
  });

  it('scrub-failed + abandon → queued', () => {
    assert.equal(nextLabel(LABELS.SCRUB_FAILED, 'abandon'), LABELS.QUEUED);
  });

  it('blocked + unblock → queued', () => {
    assert.equal(nextLabel(LABELS.BLOCKED, 'unblock'), LABELS.QUEUED);
  });
});

describe('nextLabel — invalid transitions', () => {
  it('throws on unknown current label', () => {
    assert.throws(
      () => nextLabel('not-a-label', 'pick'),
      /unknown current label/
    );
  });

  it('throws on invalid event for a known label', () => {
    assert.throws(
      () => nextLabel(LABELS.QUEUED, 'approve'),
      /invalid event/
    );
  });

  it('throws when trying to transition out of the terminal "done" state', () => {
    assert.throws(
      () => nextLabel(LABELS.DONE, 'pick'),
      /terminal state/
    );
  });

  it('throws on event that would skip states (queued → done)', () => {
    assert.throws(
      () => nextLabel(LABELS.QUEUED, 'done'),
      /invalid event/
    );
  });

  it('throws on empty string label', () => {
    assert.throws(
      () => nextLabel('', 'pick'),
      /unknown current label/
    );
  });

  it('throws on empty string event', () => {
    assert.throws(
      () => nextLabel(LABELS.QUEUED, ''),
      /invalid event/
    );
  });
});

// ---------------------------------------------------------------------------
// buildGhArgs — argv arrays
// ---------------------------------------------------------------------------

describe('buildGhArgs — list', () => {
  it('returns correct argv for list (no default label — filtered in JS to dodge search lag)', () => {
    const args = buildGhArgs('list', { repo: 'owner/queue' });
    assert.deepEqual(args, [
      'issue', 'list',
      '--repo', 'owner/queue',
      '--state', 'open',
      '--json', 'number,title,body,labels',
    ]);
  });

  it('includes --label only when one is explicitly provided', () => {
    const args = buildGhArgs('list', { repo: 'owner/queue', label: 'in-progress' });
    assert.ok(args.includes('--label') && args.includes('in-progress'));
    assert.ok(!buildGhArgs('list', { repo: 'owner/queue' }).includes('--label'));
  });
});

describe('buildGhArgs — read', () => {
  it('returns correct argv for read', () => {
    const args = buildGhArgs('read', { repo: 'owner/queue', number: 42 });
    assert.deepEqual(args, [
      'issue', 'view', '42',
      '--repo', 'owner/queue',
      '--json', 'number,title,body,labels,comments',
    ]);
  });

  it('converts number to string in argv', () => {
    const args = buildGhArgs('read', { repo: 'r/r', number: 7 });
    assert.equal(typeof args[2], 'string');
    assert.equal(args[2], '7');
  });
});

describe('buildGhArgs — add-label / remove-label', () => {
  it('add-label argv is correct', () => {
    const args = buildGhArgs('add-label', { repo: 'owner/queue', number: 5, label: 'in-progress' });
    assert.deepEqual(args, [
      'issue', 'edit', '5',
      '--repo', 'owner/queue',
      '--add-label', 'in-progress',
    ]);
  });

  it('remove-label argv is correct', () => {
    const args = buildGhArgs('remove-label', { repo: 'owner/queue', number: 5, label: 'queued' });
    assert.deepEqual(args, [
      'issue', 'edit', '5',
      '--repo', 'owner/queue',
      '--remove-label', 'queued',
    ]);
  });
});

describe('buildGhArgs — comment', () => {
  it('returns correct argv for comment', () => {
    const args = buildGhArgs('comment', { repo: 'owner/queue', number: 10, body: 'Progress update' });
    assert.deepEqual(args, [
      'issue', 'comment', '10',
      '--repo', 'owner/queue',
      '--body', 'Progress update',
    ]);
  });
});

describe('buildGhArgs — close', () => {
  it('returns correct argv for close (reason completed)', () => {
    const args = buildGhArgs('close', { repo: 'owner/queue', number: 3 });
    assert.deepEqual(args, [
      'issue', 'close', '3',
      '--repo', 'owner/queue',
      '--reason', 'completed',
    ]);
  });
});

describe('buildGhArgs — reopen', () => {
  it('returns correct argv for reopen', () => {
    const args = buildGhArgs('reopen', { repo: 'owner/queue', number: 8 });
    assert.deepEqual(args, [
      'issue', 'reopen', '8',
      '--repo', 'owner/queue',
    ]);
  });
});

describe('buildGhArgs — unknown op', () => {
  it('throws on an unknown op string', () => {
    assert.throws(
      () => buildGhArgs('delete', { repo: 'r/r', number: 1 }),
      /unknown op/
    );
  });
});

// ---------------------------------------------------------------------------
// controlRepo — resolution order
// ---------------------------------------------------------------------------

describe('controlRepo', () => {
  // Save/restore env
  let savedEnv;
  beforeEach(() => { savedEnv = process.env.CLAUDE_WORKFLOW_CONTROL_REPO; });
  after(() => {
    if (savedEnv === undefined) {
      delete process.env.CLAUDE_WORKFLOW_CONTROL_REPO;
    } else {
      process.env.CLAUDE_WORKFLOW_CONTROL_REPO = savedEnv;
    }
  });

  it('returns opts.repo when provided', () => {
    delete process.env.CLAUDE_WORKFLOW_CONTROL_REPO;
    const { controlRepo } = require('../lib/queue-cli.js');
    assert.equal(controlRepo({ repo: 'flag/repo' }), 'flag/repo');
  });

  it('opts.repo takes precedence over env var', () => {
    process.env.CLAUDE_WORKFLOW_CONTROL_REPO = 'env/repo';
    const { controlRepo } = require('../lib/queue-cli.js');
    assert.equal(controlRepo({ repo: 'flag/repo' }), 'flag/repo');
  });

  it('falls back to CLAUDE_WORKFLOW_CONTROL_REPO env var', () => {
    process.env.CLAUDE_WORKFLOW_CONTROL_REPO = 'env/queue-repo';
    const { controlRepo } = require('../lib/queue-cli.js');
    assert.equal(controlRepo({}), 'env/queue-repo');
  });

  it('throws a clear error when neither opts.repo nor env var is set', () => {
    delete process.env.CLAUDE_WORKFLOW_CONTROL_REPO;
    const { controlRepo } = require('../lib/queue-cli.js');
    assert.throws(
      () => controlRepo({}),
      /CLAUDE_WORKFLOW_CONTROL_REPO/
    );
  });

  it('throws when opts.repo is an empty string', () => {
    delete process.env.CLAUDE_WORKFLOW_CONTROL_REPO;
    const { controlRepo } = require('../lib/queue-cli.js');
    assert.throws(
      () => controlRepo({ repo: '   ' }),
      /CLAUDE_WORKFLOW_CONTROL_REPO/
    );
  });

  it('trims whitespace from opts.repo', () => {
    delete process.env.CLAUDE_WORKFLOW_CONTROL_REPO;
    const { controlRepo } = require('../lib/queue-cli.js');
    assert.equal(controlRepo({ repo: '  owner/queue  ' }), 'owner/queue');
  });

  it('trims whitespace from env var', () => {
    process.env.CLAUDE_WORKFLOW_CONTROL_REPO = '  env/trimmed  ';
    const { controlRepo } = require('../lib/queue-cli.js');
    assert.equal(controlRepo({}), 'env/trimmed');
  });
});
