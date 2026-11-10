/**
 * Tests for the saved workflows in workflows/.
 * The scripts run inside Claude Code's workflow runtime. The structural checks
 * compile them and check the parts the runtime is strict about (a pure-literal
 * `meta`, phase titles that match it). The behaviour checks run each script
 * against a stub runtime whose agent() returns canned results, so the control
 * flow is tested without starting any real agent.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'workflows');
const RUNTIME_GLOBALS = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow'];
const FILES = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));

function split(source) {
  const match = source.match(/^export const meta = (\{[\s\S]*?\n\})\n/);
  assert.ok(match, 'script must start with `export const meta = {...}`');
  return { metaSource: match[1], body: source.slice(match[0].length) };
}

// ---------------------------------------------------------------------------
// Stub runtime
// ---------------------------------------------------------------------------

/**
 * Run a workflow script with stubbed runtime globals.
 * `respond(call)` returns the agent result for one call; call = { prompt, opts, kind }.
 * `kind` is the agent type without the plugin prefix, or the label's first word.
 */
async function runScript(file, { args, respond }) {
  const { body } = split(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const calls = [];
  const logs = [];
  const agent = async (prompt, opts) => {
    const kind = opts.agentType ? opts.agentType.replace(/^workflow:/, '') : opts.label.split(':')[0];
    const call = { prompt, opts, kind };
    calls.push(call);
    return respond(call);
  };
  const parallel = thunks => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null)));
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let value = item;
    for (const stage of stages) {
      try { value = await stage(value, item, i); } catch { return null; }
    }
    return value;
  }));
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const fn = new Function(...RUNTIME_GLOBALS, `return (async () => {\n${body}\n})`);
  const result = await fn(agent, parallel, pipeline, () => {}, m => logs.push(m), args, budget, async () => null)();
  return { result, calls, logs };
}

const of = (calls, kind) => calls.filter(c => c.kind === kind);

function finding(over) {
  return {
    severity: 'MAJOR', confidence: 'high', title: 'Off-by-one in loop', file: 'src/a.js', line: 10,
    failure_scenario: 'An empty list reads index 0 and throws', fix: 'Use < instead of <=', ...over,
  };
}

/** Verdicts for every finding in a verifier prompt; `real(f)` decides, `evidence` can be dropped. */
function verdictsFor(prompt, { real = () => true, evidence = true } = {}) {
  const chunk = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n[') + 2));
  return {
    verdicts: chunk.map(f => ({
      index: f.index,
      real: real(f),
      reason: 'checked',
      evidence: evidence ? { file: f.file, line: f.line || 1, quote: 'for (let i = 0; i <= n; i++)' } : { file: '', line: 0, quote: '' },
    })),
  };
}

function reviewResponder({ risk = 'high', files = ['src/a.js'], lenses = {}, merge, verify = {} } = {}) {
  return ({ kind, prompt, opts }) => {
    if (kind === 'scope') return { risk, files, untracked: [], signals: [] };
    if (kind === 'reviewer-deep') return { findings: (lenses.quality || []).map(f => finding(f)) };
    if (kind === 'security-deep') return { findings: (lenses.security || []).map(f => finding(f)) };
    if (kind === 'finding-merger') return merge ? merge(prompt) : { groups: [] };
    if (kind === 'verifier') return verdictsFor(prompt, verify);
    throw new Error(`unexpected agent ${opts.label}`);
  };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('saved workflows', () => {
  it('ships plan, implement and review', () => {
    for (const name of ['plan.js', 'implement.js', 'review.js']) assert.ok(FILES.includes(name), name);
  });

  for (const file of FILES) {
    describe(file, () => {
      const source = fs.readFileSync(path.join(DIR, file), 'utf8');
      const { metaSource, body } = split(source);

      it('has a pure-literal meta with name and description', () => {
        assert.doesNotMatch(metaSource, /\$\{|\.\.\.|\b[A-Za-z_]\w*\(/, 'meta must not interpolate, spread or call');
        const meta = vm.runInNewContext(`(${metaSource})`);
        assert.equal(meta.name, path.basename(file, '.js'));
        assert.ok(meta.description && meta.description.length > 0);
      });

      it('compiles as an async script body', () => {
        assert.doesNotThrow(() => new Function(...RUNTIME_GLOBALS, `return (async () => {\n${body}\n})`));
      });

      it('uses only phase titles declared in meta', () => {
        const meta = vm.runInNewContext(`(${metaSource})`);
        const declared = new Set((meta.phases || []).map(p => p.title));
        const used = new Set([
          ...[...body.matchAll(/phase\('([^']+)'\)/g)].map(m => m[1]),
          ...[...body.matchAll(/phase: '([^']+)'/g)].map(m => m[1]),
        ]);
        for (const title of used) assert.ok(declared.has(title), `phase "${title}" missing from meta.phases`);
      });

      it('avoids clock and randomness, which break resume', () => {
        assert.doesNotMatch(body, /Date\.now\(|Math\.random\(|new Date\(\)/);
      });

      it('only uses plugin agents registered in plugin.json', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
        for (const [, name] of body.matchAll(/agentType: 'workflow:([a-z-]+)'/g)) {
          assert.ok(manifest.agents.includes(`./agents/${name}.md`), `workflow:${name} is not registered`);
        }
      });
    });
  }

  it('keeps the shared review core identical in review.js and implement.js', () => {
    const core = file => {
      const s = fs.readFileSync(path.join(DIR, file), 'utf8');
      const start = s.indexOf('// ==== shared review core');
      const end = s.indexOf('// ==== end shared review core ====');
      assert.ok(start >= 0 && end > start, `${file} has the shared core markers`);
      return s.slice(start, end);
    };
    assert.equal(core('implement.js'), core('review.js'));
  });
});

// ---------------------------------------------------------------------------
// review.js behaviour
// ---------------------------------------------------------------------------

describe('review workflow', () => {
  it('returns MINOR findings as notes and starts no verifier for them', async () => {
    const { result, calls } = await runScript('review.js', {
      args: {},
      respond: reviewResponder({ lenses: { quality: [{ severity: 'MINOR', title: 'Naming' }] } }),
    });
    assert.equal(of(calls, 'verifier').length, 0);
    assert.equal(of(calls, 'finding-merger').length, 0);
    assert.equal(result.notes.length, 1);
    assert.equal(result.confirmed.length, 0);
  });

  it('runs only the quality lens, with a security checklist, when the risk is low', async () => {
    const { result, calls } = await runScript('review.js', { args: {}, respond: reviewResponder({ risk: 'low' }) });
    assert.equal(of(calls, 'security-deep').length, 0);
    assert.equal(of(calls, 'reviewer-deep').length, 1);
    assert.match(of(calls, 'reviewer-deep')[0].prompt, /classified low risk/);
    assert.deepEqual(result.lenses_run, ['quality']);
    assert.equal(result.scope.risk, 'low');
  });

  it('runs both lenses when the risk is not low', async () => {
    const { calls } = await runScript('review.js', { args: {}, respond: reviewResponder({ risk: 'medium' }) });
    assert.equal(of(calls, 'security-deep').length, 1);
    assert.doesNotMatch(of(calls, 'reviewer-deep')[0].prompt, /classified low risk/);
  });

  it('passes args.paths and base to the scope agent and reports the scoped files', async () => {
    const { result, calls } = await runScript('review.js', {
      args: { paths: ['src', 'docs/x.md'], base: 'main' },
      respond: reviewResponder({ files: ['src/a.js', 'docs/x.md'] }),
    });
    assert.match(of(calls, 'scope')[0].prompt, /Base ref: main/);
    assert.match(of(calls, 'scope')[0].prompt, /Paths: src docs\/x\.md/);
    assert.deepEqual(result.scope.files, ['src/a.js', 'docs/x.md']);
    assert.match(of(calls, 'reviewer-deep')[0].prompt, /git diff main -- <file>/);
  });

  it('stops before any lens when nothing is in scope', async () => {
    const { result, calls } = await runScript('review.js', { args: {}, respond: reviewResponder({ files: [] }) });
    assert.equal(result.status, 'empty');
    assert.equal(of(calls, 'reviewer-deep').length, 0);
  });

  it('skips the merge step when only one lens raised blocking findings', async () => {
    const { calls } = await runScript('review.js', {
      args: {},
      respond: reviewResponder({ lenses: { quality: [{ title: 'A' }, { title: 'B', line: 40 }] } }),
    });
    assert.equal(of(calls, 'finding-merger').length, 0);
  });

  it('merges duplicates across lenses before verification', async () => {
    const { result, calls } = await runScript('review.js', {
      args: {},
      respond: reviewResponder({
        lenses: { quality: [{ title: 'Cache trusted on read' }], security: [{ title: 'Planted cache file accepted' }] },
        merge: () => ({ groups: [[0, 1]] }),
      }),
    });
    assert.equal(of(calls, 'finding-merger').length, 1);
    assert.equal(result.confirmed.length, 1);
    assert.equal(result.confirmed[0].lens, 'quality+security');
    assert.equal(result.confirmed[0].merged, 2);
  });

  it('gives a quality MAJOR one verifier and a security MAJOR or any CRITICAL three', async () => {
    const { calls } = await runScript('review.js', {
      args: {},
      respond: reviewResponder({
        lenses: { quality: [{ title: 'Q', line: 1 }, { title: 'C', severity: 'CRITICAL', line: 90 }], security: [{ title: 'S', line: 50 }] },
        merge: () => ({ groups: [[0], [1], [2]] }),
      }),
    });
    const verifiers = of(calls, 'verifier').map(c => JSON.parse(c.prompt.slice(c.prompt.lastIndexOf('\n\n[') + 2)));
    const single = verifiers.filter(chunk => chunk.some(f => f.title === 'Q'));
    const triple = verifiers.filter(chunk => chunk.some(f => f.title === 'S' || f.title === 'C'));
    assert.equal(single.length, 1);
    assert.equal(triple.length, 3);
  });

  it('sends at most four findings to each verifier', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `Defect ${i}`, line: i * 20 + 1 }));
    const { calls } = await runScript('review.js', { args: {}, respond: reviewResponder({ lenses: { quality: six } }) });
    const sizes = of(calls, 'verifier').map(c => JSON.parse(c.prompt.slice(c.prompt.lastIndexOf('\n\n[') + 2)).length);
    assert.deepEqual(sizes.sort(), [2, 4]);
  });

  it('counts a verdict without a quote as no verdict', async () => {
    const { result } = await runScript('review.js', {
      args: {},
      respond: reviewResponder({ lenses: { quality: [{ title: 'Q' }] }, verify: { evidence: false } }),
    });
    assert.equal(result.confirmed.length, 0);
    assert.equal(result.refuted.length, 0);
    assert.equal(result.unverified.length, 1);
  });

  it('needs a majority of evidence-backed verdicts for a security MAJOR', async () => {
    let n = 0;
    const { result } = await runScript('review.js', {
      args: {},
      respond: reviewResponder({ lenses: { security: [{ title: 'S' }] }, verify: { real: () => (n++ < 1) } }),
    });
    assert.equal(result.refuted.length, 1, 'one real against two not-real is refuted');
  });

  it('stops at max_agents and says so', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `Defect ${i}`, line: i * 20 + 1 }));
    const { result, calls } = await runScript('review.js', {
      args: { max_agents: 3 },
      respond: reviewResponder({ risk: 'low', lenses: { quality: six } }),
    });
    assert.equal(calls.length, 3);
    assert.equal(result.status, 'stopped');
    assert.match(result.stopped, /agent cap of 3/);
    assert.equal(result.unverified.length, 2, 'findings whose verifier never started stay unverified');
  });
});

// ---------------------------------------------------------------------------
// implement.js behaviour
// ---------------------------------------------------------------------------

function planWith(over) {
  return {
    status: 'plan',
    plan: {
      summary: 'Add a helper',
      acceptance_criteria: ['helper works'],
      work_items: [
        { id: 'W1', title: 'Helper', description: 'Write it', files: ['src/a.js'] },
        { id: 'W2', title: 'Hardening', description: 'Optional extra', files: ['src/b.js'], optional: true },
      ],
      ...over,
    },
  };
}

/**
 * Responder for implement runs. `rounds[n]` gives the lens findings for review round n
 * (quality only; risk is low unless set). `fix` builds the fix result.
 */
function implementResponder({ risk = 'low', scopeFiles = ['src/a.js', 'tests/a.test.js'], rounds = {}, fix, signOff = { approved: true, issues: [] } } = {}) {
  return ({ kind, prompt, opts }) => {
    if (opts.label.startsWith('exec:')) return { status: 'done', files_changed: [`src/${opts.label === 'exec:W1' ? 'a' : 'b'}.js`], notes: '' };
    if (kind === 'test-writer') return { test_files: ['tests/a.test.js'], passed: 3, failed: 0 };
    if (kind === 'scope') return { risk, files: scopeFiles, untracked: [], signals: [] };
    if (kind === 'reviewer-deep' || kind === 'security-deep') {
      if (kind === 'security-deep') return { findings: [] };
      const round = Number(opts.label.split(':r')[1]);
      return { findings: (rounds[round] || []).map(f => finding(f)) };
    }
    if (kind === 'verifier') return verdictsFor(prompt);
    if (opts.label.startsWith('fix:')) return fix ? fix(prompt) : { fixes: [{ id: 'ISSUE-1', status: 'FIXED', detail: 'done', regions: [{ file: 'src/a.js', start_line: 9, end_line: 12 }] }], files_changed: ['src/a.js'] };
    if (kind === 'completion-guard') return signOff;
    throw new Error(`unexpected agent ${opts.label}`);
  };
}

describe('implement workflow', () => {
  it('skips optional work items unless include_optional is set', async () => {
    const skipped = await runScript('implement.js', { args: { plan: planWith() }, respond: implementResponder() });
    assert.deepEqual(skipped.calls.filter(c => c.opts.label.startsWith('exec:')).map(c => c.opts.label), ['exec:W1']);
    assert.deepEqual(skipped.result.skipped_optional.map(i => i.id), ['W2']);

    const built = await runScript('implement.js', { args: { plan: planWith(), include_optional: true }, respond: implementResponder() });
    assert.equal(built.calls.filter(c => c.opts.label.startsWith('exec:')).length, 2);
  });

  it('skips the test-writer when the plan put tests in its work items', async () => {
    const { result, calls } = await runScript('implement.js', { args: { plan: planWith({ tests_in_items: true }) }, respond: implementResponder() });
    assert.equal(of(calls, 'test-writer').length, 0);
    assert.equal(result.tests.skipped, true);
  });

  it('scopes the review to the plan files plus reported changes by default, args.paths otherwise', async () => {
    const auto = await runScript('implement.js', { args: { plan: planWith() }, respond: implementResponder() });
    assert.match(of(auto.calls, 'scope')[0].prompt, /Paths: src\/a\.js tests\/a\.test\.js/);

    const given = await runScript('implement.js', { args: { plan: planWith(), paths: ['lib'] }, respond: implementResponder() });
    assert.match(of(given.calls, 'scope')[0].prompt, /Paths: lib$/m);
  });

  it('completes when the fix round leaves nothing open', async () => {
    const { result, calls } = await runScript('implement.js', {
      args: { plan: planWith() },
      respond: implementResponder({ rounds: { 1: [{ title: 'Off-by-one' }], 2: [] } }),
    });
    assert.equal(result.status, 'complete');
    assert.equal(result.review.rounds, 2);
    assert.equal(of(calls, 'scope').length, 1, 'scope runs once per run');
    assert.equal(result.sign_off.ran, true);
  });

  it('gives round 2 only the fix regions, the open findings and the refuted list', async () => {
    const { calls } = await runScript('implement.js', {
      args: { plan: planWith() },
      respond: (call) => {
        if (call.kind === 'verifier') return verdictsFor(call.prompt, { real: f => f.title !== 'Not real' });
        return implementResponder({ rounds: { 1: [{ title: 'Off-by-one' }, { title: 'Not real', line: 70 }], 2: [] } })(call);
      },
    });
    const round2 = calls.find(c => c.opts.label === 'lens:quality:r2').prompt;
    assert.match(round2, /"start_line": 9|"start_line":9/);
    assert.match(round2, /previous_id/);
    assert.match(round2, /Not real/);
  });

  it('sends whole touched files to round 2 when a fix reports no regions', async () => {
    const { calls } = await runScript('implement.js', {
      args: { plan: planWith() },
      respond: implementResponder({
        rounds: { 1: [{ title: 'Off-by-one' }], 2: [] },
        fix: () => ({ fixes: [{ id: 'ISSUE-1', status: 'FIXED', detail: 'done' }], files_changed: ['src/a.js'] }),
      }),
    });
    assert.match(calls.find(c => c.opts.label === 'lens:quality:r2').prompt, /whole files \(no exact regions were reported\): src\/a\.js/);
  });

  it('keeps a finding open when round 2 re-reports it by previous_id', async () => {
    const { result } = await runScript('implement.js', {
      args: { plan: planWith(), max_fix_rounds: 1 },
      respond: implementResponder({ rounds: { 1: [{ title: 'Off-by-one' }], 2: [{ title: 'Off-by-one', previous_id: 'ISSUE-1' }] } }),
    });
    assert.equal(result.status, 'needs_attention');
    assert.equal(result.review.open.length, 1);
    assert.equal(result.review.open[0].id, 'ISSUE-1');
  });

  it('resolves the scope again when a fix touches a file outside it', async () => {
    const { calls } = await runScript('implement.js', {
      args: { plan: planWith() },
      respond: implementResponder({
        rounds: { 1: [{ title: 'Off-by-one' }], 2: [] },
        fix: () => ({ fixes: [{ id: 'ISSUE-1', status: 'FIXED', detail: 'done', regions: [{ file: 'src/c.js', start_line: 1, end_line: 2 }] }], files_changed: ['src/c.js'] }),
      }),
    });
    assert.equal(of(calls, 'scope').length, 2);
    assert.match(of(calls, 'scope')[1].prompt, /src\/c\.js/);
  });

  it('keeps a slot for sign-off when the agent cap stops the review', async () => {
    const { result, calls } = await runScript('implement.js', {
      args: { plan: planWith(), max_agents: 5 },
      respond: implementResponder({ rounds: { 1: [{ title: 'Off-by-one' }] } }),
    });
    assert.equal(calls.length, 5);
    assert.match(result.stopped, /agent cap of 5/);
    assert.equal(result.sign_off.ran, true);
    assert.equal(result.status, 'needs_attention');
  });

  it('says sign-off did not run when it could not start', async () => {
    const { result } = await runScript('implement.js', {
      args: { plan: planWith() },
      respond: (call) => {
        if (call.kind === 'completion-guard') throw new Error('token budget exhausted');
        return implementResponder()(call);
      },
    });
    assert.equal(result.sign_off.ran, false);
    assert.match(result.sign_off.reason, /token budget exhausted/);
    assert.equal(result.status, 'needs_attention');
  });
});

// ---------------------------------------------------------------------------
// plan.js behaviour
// ---------------------------------------------------------------------------

describe('plan workflow', () => {
  const explorerResult = angle => ({ angle, findings: [{ claim: 'x', files: ['a.js'] }], relevant_files: ['a.js'] });

  it('returns its findings and the areas to explore with its questions', async () => {
    const { result, calls } = await runScript('plan.js', {
      args: { task: 'Add a helper' },
      respond: ({ kind }) => kind === 'explorer'
        ? explorerResult('a')
        : { status: 'questions', questions: [{ question: 'Which format?', why: 'changes the parser' }], explore: ['config loading'] },
    });
    assert.equal(of(calls, 'explorer').length, 3);
    assert.equal(result.status, 'questions');
    assert.equal(result.findings.length, 3);
    assert.deepEqual(result.explore, ['config loading']);
  });

  it('goes straight to the judge in a follow-up round with nothing new to explore', async () => {
    const { calls } = await runScript('plan.js', {
      args: { task: 'Add a helper', round: 2, findings: [explorerResult('a')], answers: [{ question: 'Which format?', answer: 'JSON' }] },
      respond: () => ({ status: 'plan', plan: { summary: 's', acceptance_criteria: ['a'], work_items: [{ id: 'W1', title: 't', description: 'd', files: ['a.js'] }] } }),
    });
    assert.equal(of(calls, 'explorer').length, 0);
    assert.equal(of(calls, 'architect').length, 1);
    assert.match(of(calls, 'architect')[0].prompt, /do not explore the codebase again/);
  });

  it('explores only the named areas in a follow-up round', async () => {
    const { calls } = await runScript('plan.js', {
      args: { task: 'Add a helper', round: 2, findings: [explorerResult('a')], explore: ['config loading'] },
      respond: ({ kind }) => kind === 'explorer'
        ? explorerResult('config loading')
        : { status: 'plan', plan: { summary: 's', acceptance_criteria: ['a'], work_items: [{ id: 'W1', title: 't', description: 'd', files: ['a.js'] }] } },
    });
    assert.equal(of(calls, 'explorer').length, 1);
    assert.match(of(calls, 'explorer')[0].prompt, /Your angle: config loading/);
  });
});

// ---------------------------------------------------------------------------
// Merge guard
// ---------------------------------------------------------------------------

describe('finding merge guard', () => {
  const twoLenses = { quality: [{ title: 'Cache trusted on read' }], security: [{ title: 'Planted cache file accepted' }] };

  for (const [label, groups] of [
    ['an index in two groups', [[0, 1], [1]]],
    ['a missing index', [[0]]],
    ['an out-of-range index', [[0, 1, 2]]],
    ['an empty group', [[0, 1], []]],
    ['a non-integer index', [[0, '1']]],
  ]) {
    it(`verifies the findings unmerged when the merger returns ${label}`, async () => {
      const { result, logs } = await runScript('review.js', {
        args: {},
        respond: reviewResponder({ lenses: twoLenses, merge: () => ({ groups }) }),
      });
      assert.equal(result.confirmed.length, 2, 'both findings survive');
      assert.ok(result.confirmed.every(f => !f.merged_from));
      assert.ok(logs.some(l => /not an exact partition/.test(l)));
    });
  }

  it('keeps every member of a merged finding in merged_from', async () => {
    const { result } = await runScript('review.js', {
      args: {},
      respond: reviewResponder({ lenses: twoLenses, merge: () => ({ groups: [[1, 0]] }) }),
    });
    assert.equal(result.confirmed.length, 1);
    assert.deepEqual(result.confirmed[0].merged_from.map(f => f.title).sort(), ['Cache trusted on read', 'Planted cache file accepted']);
  });
});

// ---------------------------------------------------------------------------
// Effort overrides
// ---------------------------------------------------------------------------

describe('per-run effort overrides', () => {
  const blocking = { quality: [{ title: 'Q' }], security: [{ title: 'S', line: 50 }] };
  const effortOf = (calls, kind) => of(calls, kind).map(c => c.opts.effort);

  it('passes no effort anywhere when none is given', async () => {
    const { result, calls } = await runScript('review.js', { args: {}, respond: reviewResponder({ lenses: blocking, merge: () => ({ groups: [[0], [1]] }) }) });
    assert.ok(calls.every(c => !('effort' in c.opts)));
    assert.deepEqual(result.effort, { judge: 'frontmatter', worker: 'frontmatter', mechanical: 'frontmatter' });
  });

  it('applies judge_effort to the lenses only and worker_effort to the verifiers only', async () => {
    const { result, calls } = await runScript('review.js', {
      args: { judge_effort: 'xhigh', worker_effort: 'low' },
      respond: reviewResponder({ lenses: blocking, merge: () => ({ groups: [[0], [1]] }) }),
    });
    assert.deepEqual(effortOf(calls, 'reviewer-deep'), ['xhigh']);
    assert.deepEqual(effortOf(calls, 'security-deep'), ['xhigh']);
    assert.ok(effortOf(calls, 'verifier').length > 0 && effortOf(calls, 'verifier').every(e => e === 'low'));
    assert.deepEqual(effortOf(calls, 'scope'), [undefined], 'haiku agents keep their frontmatter level');
    assert.deepEqual(effortOf(calls, 'finding-merger'), [undefined]);
    assert.deepEqual(result.effort, { judge: 'xhigh', worker: 'low', mechanical: 'frontmatter' });
  });

  it('stops before any agent on an unknown level', async () => {
    let started = 0;
    await assert.rejects(
      runScript('review.js', { args: { judge_effort: 'extreme' }, respond: () => { started++; return null; } }),
      /judge_effort must be one of low, medium, high, xhigh, max \(got "extreme"\)/,
    );
    assert.equal(started, 0);
  });

  it('routes the tiers in implement: judges to lenses and sign-off, workers to executors, tests and verifiers', async () => {
    const { result, calls } = await runScript('implement.js', {
      args: { plan: planWith(), judge_effort: 'max', worker_effort: 'medium' },
      respond: implementResponder({ rounds: { 1: [{ title: 'Off-by-one' }], 2: [] } }),
    });
    assert.ok(calls.filter(c => c.kind === 'reviewer-deep').every(c => c.opts.effort === 'max'));
    assert.equal(of(calls, 'completion-guard')[0].opts.effort, 'max');
    assert.ok(calls.filter(c => c.kind === 'executor' || c.kind === 'test-writer' || c.kind === 'verifier').every(c => c.opts.effort === 'medium'));
    assert.ok(of(calls, 'scope').every(c => !('effort' in c.opts)));
    assert.deepEqual(result.effort, { judge: 'max', worker: 'medium', mechanical: 'frontmatter' });
  });

  it('rejects an unknown worker level in implement', async () => {
    await assert.rejects(
      runScript('implement.js', { args: { plan: planWith(), worker_effort: 'HIGH' }, respond: () => null }),
      /worker_effort must be one of/,
    );
  });

  it('routes the tiers in plan: judge to the architect, worker to the explorers', async () => {
    const { result, calls } = await runScript('plan.js', {
      args: { task: 'Add a helper', judge_effort: 'high', worker_effort: 'low' },
      respond: ({ kind }) => kind === 'explorer'
        ? { angle: 'a', findings: [], relevant_files: [] }
        : { status: 'questions', questions: [{ question: 'q', why: 'w' }] },
    });
    assert.ok(of(calls, 'explorer').every(c => c.opts.effort === 'low'));
    assert.equal(of(calls, 'architect')[0].opts.effort, 'high');
    assert.deepEqual(result.effort, { judge: 'high', worker: 'low' });
  });

  it('passes no effort in plan when none is given, and rejects unknown levels', async () => {
    const { calls } = await runScript('plan.js', {
      args: { task: 'Add a helper' },
      respond: ({ kind }) => kind === 'explorer' ? { angle: 'a', findings: [], relevant_files: [] } : { status: 'questions', questions: [] },
    });
    assert.ok(calls.every(c => !('effort' in c.opts)));
    await assert.rejects(runScript('plan.js', { args: { task: 't', judge_effort: 'ultra' }, respond: () => null }), /judge_effort must be one of/);
  });

  it('uses the same effort levels in plan.js as in the shared review core', () => {
    const levels = file => fs.readFileSync(path.join(DIR, file), 'utf8').match(/const EFFORT_LEVELS = (\[[^\]]*\])/)[1];
    assert.equal(levels('plan.js'), levels('review.js'));
  });
});

// ---------------------------------------------------------------------------
// Per-lens stats and sign-off brief
// ---------------------------------------------------------------------------

describe('per-lens stats', () => {
  it('reports candidates, blocking and confirmed-only counts for each lens in review', async () => {
    const { result } = await runScript('review.js', {
      args: {},
      respond: reviewResponder({
        lenses: {
          quality: [{ title: 'Q1' }, { title: 'Naming', severity: 'MINOR', line: 30 }],
          security: [{ title: 'S1', line: 60 }, { title: 'Same as Q1 from security', line: 11 }],
        },
        // Q1 (0) and its security twin (2) merge; S1 (1) stands alone.
        merge: () => ({ groups: [[0, 2], [1]] }),
      }),
    });
    const by = Object.fromEntries(result.lens_stats.map(s => [s.lens, s]));
    assert.deepEqual(by.quality, { lens: 'quality', candidates: 2, blocking: 1, confirmed_only_this_lens: 0, confirmed_with_other_lens: 1 });
    assert.deepEqual(by.security, { lens: 'security', candidates: 2, blocking: 2, confirmed_only_this_lens: 1, confirmed_with_other_lens: 1 });
  });

  it('records per-lens stats for every implement review round', async () => {
    const { result } = await runScript('implement.js', {
      args: { plan: planWith() },
      respond: implementResponder({ rounds: { 1: [{ title: 'Off-by-one' }], 2: [] } }),
    });
    assert.deepEqual(result.review.lens_stats.map(r => r.round), [1, 2]);
    assert.equal(result.review.lens_stats[0].lenses[0].confirmed_only_this_lens, 1);
  });
});

describe('implement sign-off brief', () => {
  it('limits the sign-off to the code, the suite and a few targeted checks', async () => {
    const { calls } = await runScript('implement.js', { args: { plan: planWith() }, respond: implementResponder() });
    const prompt = of(calls, 'completion-guard')[0].prompt;
    assert.match(prompt, /at most a few targeted checks/);
    assert.match(prompt, /do not build new test inputs/);
  });
});

// ---------------------------------------------------------------------------
// Plain-text args (what a slash command passes)
// ---------------------------------------------------------------------------

describe('plain-text args from a slash command', () => {
  const planResult = { status: 'questions', questions: [{ question: 'q', why: 'w' }] };
  const explorer = { angle: 'a', findings: [], relevant_files: [] };

  it('plan treats a string as the task', async () => {
    const { calls } = await runScript('plan.js', {
      args: '  add rate limiting to the login endpoint  ',
      respond: ({ kind }) => (kind === 'explorer' ? explorer : planResult),
    });
    assert.match(of(calls, 'architect')[0].prompt, /Task: add rate limiting to the login endpoint\n/);
  });

  it('plan reads a string holding a JSON object as the args object', async () => {
    const { calls } = await runScript('plan.js', {
      args: '{"task": "add a helper", "worker_effort": "low"}',
      respond: ({ kind }) => (kind === 'explorer' ? explorer : planResult),
    });
    assert.ok(of(calls, 'explorer').every(c => c.opts.effort === 'low'));
  });

  it('plan still stops with a clear message when no task is given', async () => {
    await assert.rejects(runScript('plan.js', { args: '   ', respond: () => null }), /a task is required/);
  });

  it('review treats a string as the context of the change', async () => {
    const { calls } = await runScript('review.js', { args: 'tighten the cache trust rules', respond: reviewResponder() });
    assert.match(of(calls, 'reviewer-deep')[0].prompt, /Intent of the change: tighten the cache trust rules/);
  });

  it('implement refuses plain text and points to /workflow:do', async () => {
    await assert.rejects(
      runScript('implement.js', { args: 'add rate limiting', respond: () => null }),
      /needs the plan result from \/workflow:plan.*use \/workflow:do/s,
    );
  });

  it('implement accepts the plan result passed as a JSON string', async () => {
    const { result } = await runScript('implement.js', { args: JSON.stringify({ plan: planWith() }), respond: implementResponder() });
    assert.equal(result.items[0].id, 'W1');
  });
});

// ---------------------------------------------------------------------------
// Judge fallback
// ---------------------------------------------------------------------------

describe('judge fallback', () => {
  /** Wrap a responder so the first call of `kind` returns null (a judge that produced nothing). */
  function failFirst(kind, inner) {
    let failed = false;
    return (call) => {
      if (call.kind === kind && !failed) { failed = true; return null; }
      return inner(call);
    };
  }

  it('retries a judge that returned nothing once on opus and records it', async () => {
    const { result, calls, logs } = await runScript('review.js', {
      args: {},
      respond: failFirst('reviewer-deep', reviewResponder({ risk: 'low', lenses: { quality: [{ title: 'Q' }] } })),
    });
    const lens = of(calls, 'reviewer-deep');
    assert.equal(lens.length, 2);
    assert.equal(lens[0].opts.model, undefined);
    assert.equal(lens[1].opts.model, 'opus');
    assert.equal(lens[1].opts.label, 'lens:quality:r1:fallback');
    assert.deepEqual(result.judge_fallback, { model: 'opus', used: [{ label: 'lens:quality:r1', model: 'opus', result: 'ok' }] });
    assert.equal(result.confirmed.length, 1, 'the retried lens result is used');
    assert.ok(logs.some(l => /cannot see why/.test(l)));
  });

  it('honours another fallback model', async () => {
    const { calls, result } = await runScript('review.js', {
      args: { judge_fallback: 'sonnet' },
      respond: failFirst('security-deep', reviewResponder()),
    });
    assert.equal(of(calls, 'security-deep')[1].opts.model, 'sonnet');
    assert.equal(result.judge_fallback.model, 'sonnet');
  });

  it('does not retry when the fallback is "none"', async () => {
    const { calls, result } = await runScript('review.js', {
      args: { judge_fallback: 'none' },
      respond: failFirst('reviewer-deep', reviewResponder({ risk: 'low' })),
    });
    assert.equal(of(calls, 'reviewer-deep').length, 1);
    assert.deepEqual(result.lenses_missing, ['quality']);
    assert.deepEqual(result.judge_fallback, { model: 'none', used: [] });
  });

  it('never retries a worker on the fallback', async () => {
    const { calls, result } = await runScript('review.js', {
      args: {},
      respond: failFirst('verifier', reviewResponder({ risk: 'low', lenses: { quality: [{ title: 'Q' }] } })),
    });
    assert.equal(of(calls, 'verifier').length, 1);
    assert.equal(result.unverified.length, 1);
    assert.deepEqual(result.judge_fallback.used, []);
  });

  it('stops before any agent on an invalid fallback value', async () => {
    let started = 0;
    await assert.rejects(
      runScript('review.js', { args: { judge_fallback: 'two words' }, respond: () => { started++; return null; } }),
      /judge_fallback must be a model alias or id, or "none"/,
    );
    assert.equal(started, 0);
  });

  it('retries the sign-off through its reserved slot', async () => {
    const { calls, result } = await runScript('implement.js', {
      args: { plan: planWith() },
      respond: failFirst('completion-guard', implementResponder()),
    });
    assert.equal(of(calls, 'completion-guard').length, 2);
    assert.equal(result.sign_off.ran, true);
    assert.deepEqual(result.judge_fallback.used, [{ label: 'sign-off', model: 'opus', result: 'ok' }]);
  });

  it('counts the retry against the agent cap', async () => {
    const { calls, result } = await runScript('implement.js', {
      args: { plan: planWith(), max_agents: 5 },
      respond: failFirst('reviewer-deep', implementResponder({ rounds: { 1: [{ title: 'Off-by-one' }] } })),
    });
    assert.equal(calls.length, 5);
    assert.match(result.stopped, /agent cap of 5/);
  });

  it('retries the plan judge and reports a real failure when the retry also returns nothing', async () => {
    const explorer = { angle: 'a', findings: [], relevant_files: [] };
    const ok = await runScript('plan.js', {
      args: { task: 'Add a helper' },
      respond: failFirst('architect', ({ kind }) => (kind === 'explorer' ? explorer : { status: 'questions', questions: [] })),
    });
    assert.equal(of(ok.calls, 'architect')[1].opts.model, 'opus');
    assert.deepEqual(ok.result.judge_fallback.used, [{ label: 'judge:r1', model: 'opus', result: 'ok' }]);

    await assert.rejects(
      runScript('plan.js', { args: { task: 'Add a helper' }, respond: ({ kind }) => (kind === 'explorer' ? explorer : null) }),
      /the judge returned no result/,
    );
  });

  it('uses the same default fallback in plan.js as in the shared review core', () => {
    const value = file => fs.readFileSync(path.join(DIR, file), 'utf8').match(/const DEFAULT_JUDGE_FALLBACK = '([^']+)'/)[1];
    assert.equal(value('plan.js'), value('review.js'));
    assert.equal(value('review.js'), 'opus');
  });
});

// ---------------------------------------------------------------------------
// Plan-to-implement handoff and no-op fix rounds
// ---------------------------------------------------------------------------

describe('plan to implement handoff', () => {
  it('returns the original task with the plan and tells the judge to copy exact text into work items', async () => {
    const plan = { summary: 's', acceptance_criteria: ['a'], work_items: [{ id: 'W1', title: 't', description: 'd', files: ['a.js'] }] };
    const { result, calls } = await runScript('plan.js', {
      args: { task: 'Write this block exactly: <!-- x -->', findings: [{ angle: 'a', findings: [], relevant_files: [] }] },
      respond: () => ({ status: 'plan', plan }),
    });
    assert.equal(result.task, 'Write this block exactly: <!-- x -->');
    assert.match(of(calls, 'architect')[0].prompt, /never this task text: copy any exact text/);
  });

  it('gives executors the original task when the plan result carries it', async () => {
    const withTask = await runScript('implement.js', {
      args: { plan: { ...planWith(), task: 'Use the block text <!-- tiers v1 --> verbatim' } },
      respond: implementResponder(),
    });
    assert.match(withTask.calls.find(c => c.opts.label === 'exec:W1').prompt, /Original task .*\nUse the block text <!-- tiers v1 --> verbatim/);

    const without = await runScript('implement.js', { args: { plan: planWith() }, respond: implementResponder() });
    assert.doesNotMatch(without.calls.find(c => c.opts.label === 'exec:W1').prompt, /Original task/);
  });
});

describe('no-op fix round', () => {
  it('goes to sign-off without another review when the fix changed no files', async () => {
    const { result, calls, logs } = await runScript('implement.js', {
      args: { plan: planWith() },
      respond: implementResponder({
        rounds: { 1: [{ title: 'Placeholder text shipped' }] },
        fix: () => ({ fixes: [{ id: 'ISSUE-1', status: 'DISPUTE', detail: 'the text is not available' }], files_changed: [] }),
      }),
    });
    assert.equal(calls.filter(c => c.opts.label === 'lens:quality:r2').length, 0, 'no second review round');
    assert.equal(result.review.rounds, 1);
    assert.equal(result.review.open.length, 1);
    assert.equal(result.sign_off.ran, true);
    assert.equal(result.status, 'needs_attention');
    assert.ok(result.dropped.some(d => d.why === 'the fix round changed nothing'));
    assert.ok(logs.some(l => /changed no files/.test(l)));
  });
});
