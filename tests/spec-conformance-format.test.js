/**
 * Contract between agents/spec-conformance.md and the readers of its output.
 * The supervisor and the epic orchestration extract `FAIL [CRITERION-N]` lines and
 * read the `GATE VERDICT` line; the start pipeline reads `[CRITERION-N]` blocks
 * with `status:` lines. The agent must document an output that satisfies all of
 * them, and the supervisor must keep asking for the same line forms.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const agent = fs.readFileSync(path.join(ROOT, 'agents', 'spec-conformance.md'), 'utf8');
const supervisor = fs.readFileSync(path.join(ROOT, 'agents', 'supervisor.md'), 'utf8');

const RESULT_LINE = /^(PASS|FAIL) \[CRITERION-(\d+[a-z]?)\]: \S/;

/** Fenced examples in the agent body that end in a gate verdict. */
function verdictExamples() {
  const blocks = [...agent.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1]);
  return blocks.filter(b => /^GATE VERDICT: (PASS|FAIL)$/m.test(b));
}

// Mirrors the supervisor's parse_failed_criteria: every FAIL [CRITERION-N] line.
function parseFailedCriteria(text) {
  return text.split('\n')
    .map(line => line.match(RESULT_LINE))
    .filter(m => m && m[1] === 'FAIL')
    .map(m => `CRITERION-${m[2]}`);
}

describe('spec-conformance output contract', () => {
  it('the supervisor still asks for PASS/FAIL [CRITERION-N] lines and a GATE VERDICT line', () => {
    assert.match(supervisor, /PASS \[CRITERION-N\]: /);
    assert.match(supervisor, /FAIL \[CRITERION-N\]: /);
    assert.match(supervisor, /GATE VERDICT: PASS/);
    assert.match(supervisor, /GATE VERDICT: FAIL/);
  });

  it('every verdict example carries one result line per criterion and exactly one verdict', () => {
    const examples = verdictExamples();
    assert.equal(examples.length, 2, 'one passing and one failing example');
    for (const example of examples) {
      const results = example.split('\n').filter(l => RESULT_LINE.test(l));
      assert.ok(results.length > 0, 'result lines present');
      assert.equal(example.match(/^GATE VERDICT: /gm).length, 1);
    }
  });

  it('the failing example yields the unmet criteria through the supervisor parse', () => {
    const failing = verdictExamples().find(b => /^GATE VERDICT: FAIL$/m.test(b));
    const unmet = [...failing.matchAll(/^- \[(CRITERION-\d+[a-z]?)\]:/gm)].map(m => m[1]);
    assert.deepEqual(parseFailedCriteria(failing), unmet);
  });

  it('the passing example yields no failed criteria', () => {
    const passing = verdictExamples().find(b => /^GATE VERDICT: PASS$/m.test(b));
    assert.deepEqual(parseFailedCriteria(passing), []);
  });

  it('still documents the [CRITERION-N] blocks with status lines that the start pipeline reads', () => {
    assert.match(agent, /^\[CRITERION-1\] .+\n {2}status: PASS$/m);
    assert.match(agent, /^\[CRITERION-2\] .+\n {2}status: FAIL$/m);
  });
});
