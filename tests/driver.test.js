'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const driver = require('../lib/driver-cli');
const wake = require('../lib/driver-wake');

const REPO = 'acme/queue';
let state_dir;
let target_dir;
let saved_env;

before(() => {
  saved_env = process.env.CLAUDE_WORKFLOW_STATE_DIR;
  state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-test-'));
  target_dir = path.join(state_dir, 'target-checkout');
  fs.mkdirSync(target_dir);
  process.env.CLAUDE_WORKFLOW_STATE_DIR = state_dir;
});

after(() => {
  if (saved_env === undefined) delete process.env.CLAUDE_WORKFLOW_STATE_DIR;
  else process.env.CLAUDE_WORKFLOW_STATE_DIR = saved_env;
  fs.rmSync(state_dir, { recursive: true, force: true });
});

function writePreferences(prefs) {
  fs.writeFileSync(path.join(state_dir, 'preferences.json'), JSON.stringify(prefs));
}

function resetState() {
  fs.rmSync(path.join(state_dir, 'driver'), { recursive: true, force: true });
  fs.rmSync(path.join(state_dir, 'preferences.json'), { force: true });
}

function makeTask(overrides) {
  return {
    control_repo: REPO,
    issue_number: 1,
    title: 'Add thing',
    target_repo: 'acme/app',
    repo_path: target_dir,
    stage: 'plan',
    parked: null,
    branch: 'workflow/issue-1-add-thing',
    base_branch: null,
    plan_round: 1,
    answers: [],
    attempts: { plan: 0, implement: 0, close_out: 0 },
    run: null,
    pr_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function issueBody(target_repo, priority) {
  return `## Target Repo\n${target_repo}\n\n## Description\nDo it\n\n## Priority\n${priority || 'medium'}\n`;
}

function fakeQueue(issue, queued) {
  const calls = [];
  return {
    calls,
    listQueued: (repo) => { calls.push(['listQueued', repo]); return queued || []; },
    readTask: (repo, n) => { calls.push(['readTask', repo, n]); return issue; },
    transition: (repo, n, from, to) => { calls.push(['transition', repo, n, from, to]); },
    comment: (repo, n, body) => { calls.push(['comment', repo, n, body]); },
  };
}

function run(argv, extra) {
  return driver.runCommand(['--repo', REPO, ...argv], { state_dir, env: {}, home: '/home/test', ...extra });
}

const base = { tasks: [], queued: [], control_repo: REPO, session_id: null, max_attempts: 3, foreign_wake: false };

describe('decide', () => {
  it('returns busy for a foreign wake', () => {
    assert.deepEqual(driver.decide({ ...base, foreign_wake: true, tasks: [makeTask()] }), { action: 'busy' });
  });

  it('parks at the retry limit before resuming a run', () => {
    const t = makeTask({ attempts: { plan: 3 }, run: { workflow: 'plan', run_id: 'r', session_id: 's' } });
    const d = driver.decide({ ...base, tasks: [t], session_id: 's' });
    assert.equal(d.action, 'park');
    assert.equal(d.reason, 'retry_limit');
  });

  it('resumes a run and reports whether the session matches', () => {
    const t = makeTask({ run: { workflow: 'plan', run_id: 'r', session_id: 's1' } });
    assert.equal(driver.decide({ ...base, tasks: [t], session_id: 's1' }).same_session, true);
    assert.equal(driver.decide({ ...base, tasks: [t], session_id: 's2' }).same_session, false);
    assert.equal(driver.decide({ ...base, tasks: [t] }).same_session, false);
    assert.equal(driver.decide({ ...base, tasks: [t] }).action, 'resume_run');
  });

  it('continues an active task without a run, oldest first', () => {
    const newer = makeTask({ issue_number: 2, created_at: '2026-02-01T00:00:00.000Z' });
    const older = makeTask({ issue_number: 3, created_at: '2026-01-01T00:00:00.000Z' });
    const d = driver.decide({ ...base, tasks: [newer, older] });
    assert.equal(d.action, 'continue');
    assert.equal(d.task.issue_number, 3);
  });

  it('ignores tasks of another control repo, parked tasks and done tasks', () => {
    const tasks = [
      makeTask({ control_repo: 'other/queue' }),
      makeTask({ issue_number: 2, parked: 'questions' }),
      makeTask({ issue_number: 3, stage: 'done' }),
    ];
    assert.equal(driver.decide({ ...base, tasks }).action, 'idle');
  });

  it('starts, requeues or idles on the queue', () => {
    assert.deepEqual(driver.decide({ ...base, queued: [{ number: 7 }] }), { action: 'start', issue: 7 });
    const parked = makeTask({ issue_number: 7, parked: 'questions' });
    const d = driver.decide({ ...base, tasks: [parked], queued: [{ number: 7 }] });
    assert.equal(d.action, 'requeued');
    assert.equal(d.issue, 7);
    assert.equal(d.task, parked);
    assert.deepEqual(driver.decide(base), { action: 'idle' });
  });
});

describe('readSettings', () => {
  it('returns defaults for empty preferences', () => {
    assert.deepEqual(driver.readSettings({}, '/h'), {
      target_repos: {}, demo_skill: null, max_agents: null,
      max_attempts: wake.DEFAULT_MAX_ATTEMPTS, judge_fallback: null,
      pass_lock_minutes: wake.DEFAULT_PASS_LOCK_MINUTES,
    });
  });

  it('expands home and reads values', () => {
    const s = driver.readSettings({
      target_repos: { 'a/b': '~/src/b', 'c/d': '/abs/d' },
      demo_skill: 'demo:record',
      driver_max_agents: 4,
      driver_max_attempts: 5,
      judge_fallback: 'none',
    }, '/home/x');
    assert.deepEqual(s.target_repos, { 'a/b': '/home/x/src/b', 'c/d': '/abs/d' });
    assert.equal(s.demo_skill, 'demo:record');
    assert.equal(s.max_agents, 4);
    assert.equal(s.max_attempts, 5);
    assert.equal(s.judge_fallback, 'none');
  });

  it('throws TypeError naming the key', () => {
    assert.throws(() => driver.readSettings({ target_repos: [] }, '/h'), { name: 'TypeError', message: /target_repos/ });
    assert.throws(() => driver.readSettings({ target_repos: { a: 1 } }, '/h'), /target_repos/);
    assert.throws(() => driver.readSettings({ demo_skill: 'bad skill' }, '/h'), /demo_skill/);
    assert.throws(() => driver.readSettings({ driver_max_agents: 0 }, '/h'), /driver_max_agents/);
    assert.throws(() => driver.readSettings({ driver_max_attempts: 1.5 }, '/h'), /driver_max_attempts/);
  });
});

describe('pure helpers', () => {
  it('sortQueued orders by priority then number', () => {
    const issues = [
      { number: 5, body: issueBody('a/b', 'low') },
      { number: 4, body: issueBody('a/b', 'high') },
      { number: 3, body: issueBody('a/b', 'high') },
      { number: 9, body: issueBody('a/b', 'critical') },
      { number: 1, body: issueBody('a/b', 'medium') },
    ];
    assert.deepEqual(driver.sortQueued(issues).map((i) => i.number), [9, 3, 4, 1, 5]);
  });

  it('branchName carries no control-repository identifier', () => {
    assert.equal(driver.branchName('ab12cd34'), 'workflow/task-ab12cd34');
    assert.match(driver.branchName(), /^workflow\/task-[0-9a-f]{8}$/);
    assert.notEqual(driver.branchName(), driver.branchName());
  });

  it('repliesSince returns only unmarked comments after the last marked one', () => {
    const c = (login, body) => ({ author: { login }, body, createdAt: 'x' });
    const comments = [
      c('u', 'early'),
      c('bot', `questions ${driver.DRIVER_MARKER}`),
      c('u', 'answer one'),
      c('bot', `again ${driver.DRIVER_MARKER}`),
      c('u', 'answer two'),
      c('v', 'answer three'),
    ];
    assert.deepEqual(driver.repliesSince(comments), [
      { author: 'u', body: 'answer two' },
      { author: 'v', body: 'answer three' },
    ]);
    assert.deepEqual(driver.repliesSince([c('u', 'hi')]), []);
  });
});

describe('task storage', () => {
  it('round-trips a task and sets updated_at', () => {
    resetState();
    driver.saveTask(state_dir, makeTask(), '2026-03-01T00:00:00.000Z');
    const loaded = driver.loadTask(state_dir, REPO, 1);
    assert.equal(loaded.updated_at, '2026-03-01T00:00:00.000Z');
    assert.equal(loaded.title, 'Add thing');
    assert.equal(driver.loadTasks(state_dir).length, 1);
    assert.ok(driver.taskPath(state_dir, REPO, 1).endsWith(`acme__queue__1.json`));
  });
});

describe('runCommand', () => {
  it('start reports parse_error, unmapped_repo and missing_path without saving', () => {
    resetState();
    writePreferences({ target_repos: { 'acme/app': target_dir, 'acme/gone': path.join(state_dir, 'nope') } });
    let r = run(['start', '1'], { queue: fakeQueue({ number: 1, title: 't', body: 'nothing' }) });
    assert.equal(r.reason, 'parse_error');
    r = run(['start', '1'], { queue: fakeQueue({ number: 1, title: 't', body: issueBody('acme/other') }) });
    assert.deepEqual([r.ok, r.reason, r.target_repo], [false, 'unmapped_repo', 'acme/other']);
    r = run(['start', '1'], { queue: fakeQueue({ number: 1, title: 't', body: issueBody('acme/gone') }) });
    assert.equal(r.reason, 'missing_path');
    assert.equal(driver.loadTasks(state_dir).length, 0);
  });

  it('start creates the task and its data directory', () => {
    resetState();
    writePreferences({ target_repos: { 'acme/app': target_dir } });
    const r = run(['start', '4'], { queue: fakeQueue({ number: 4, title: 'Add Thing', body: issueBody('acme/app') }) });
    assert.equal(r.ok, true);
    assert.match(r.task.branch, /^workflow\/task-[0-9a-f]{8}$/);
    assert.equal(r.task.base_branch, null);
    assert.equal(r.task.stage, 'plan');
    assert.equal(r.task.plan_round, 1);
    assert.equal(r.task.repo_path, target_dir);
    assert.ok(fs.existsSync(driver.taskPath(state_dir, REPO, 4)));
    assert.ok(fs.statSync(r.data_dir).isDirectory());
    assert.ok(r.data_dir.startsWith(state_dir));
  });

  it('patch run writes the session pointer without counting, null clears it', () => {
    resetState();
    driver.saveTask(state_dir, makeTask(), '2026-03-01T00:00:00.000Z');
    const session_file = path.join(state_dir, 'driver', wake.SESSION_FILE);
    const run_value = { workflow: 'plan', run_id: 'r1', session_id: 'sess-1' };
    const r = run(['patch', '1', JSON.stringify({ run: run_value })]);
    // Attempts are counted before the launch, with the attempt key.
    assert.equal(r.task.attempts.plan, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(session_file, 'utf8')), { session_id: 'sess-1', failed_resumes: 0 });
    run(['patch', '1', '{"run":null}']);
    assert.equal(fs.existsSync(session_file), false);
    assert.equal(driver.loadTask(state_dir, REPO, 1).run, null);
  });

  it('patch attempt increments without storing the key, from a file too', () => {
    resetState();
    driver.saveTask(state_dir, makeTask(), '2026-03-01T00:00:00.000Z');
    const file = path.join(state_dir, 'patch.json');
    fs.writeFileSync(file, '{"attempt":"close_out","stage":"close_out"}');
    const r = run(['patch', '1', '--file', file]);
    assert.equal(r.task.attempts.close_out, 1);
    assert.equal(r.task.stage, 'close_out');
    assert.equal('attempt' in r.task, false);
  });

  it('patch rejects unknown keys', () => {
    resetState();
    driver.saveTask(state_dir, makeTask(), '2026-03-01T00:00:00.000Z');
    assert.throws(() => run(['patch', '1', '{"parked":"x"}']), /not allowed/);
  });

  it('park transitions, comments with the marker and sets parked', () => {
    resetState();
    driver.saveTask(state_dir, makeTask(), '2026-03-01T00:00:00.000Z');
    fs.mkdirSync(path.join(state_dir, 'driver'), { recursive: true });
    fs.writeFileSync(path.join(state_dir, 'driver', wake.SESSION_FILE), '{"session_id":"s"}');
    const body = path.join(state_dir, 'body.md');
    fs.writeFileSync(body, 'Need answers\n');
    const q = fakeQueue({});
    run(['park', '1', 'questions', '--body-file', body], { queue: q });
    assert.deepEqual(q.calls[0], ['transition', REPO, 1, 'in-progress', 'blocked']);
    assert.equal(q.calls[1][0], 'comment');
    assert.ok(q.calls[1][3].includes(driver.DRIVER_MARKER));
    assert.ok(q.calls[1][3].startsWith('Need answers'));
    const t = driver.loadTask(state_dir, REPO, 1);
    assert.equal(t.parked, 'questions');
    assert.equal(fs.existsSync(path.join(state_dir, 'driver', wake.SESSION_FILE)), false);
  });

  it('park works without a task', () => {
    resetState();
    const body = path.join(state_dir, 'body.md');
    fs.writeFileSync(body, 'Cannot start');
    const q = fakeQueue({});
    const r = run(['park', '9', 'unmapped_repo', '--body-file', body, '--from', 'queued'], { queue: q });
    assert.equal(r.ok, true);
    assert.deepEqual(q.calls[0], ['transition', REPO, 9, 'queued', 'blocked']);
  });

  it('requeue clears parked, resets attempts and returns replies', () => {
    resetState();
    driver.saveTask(state_dir, makeTask({ parked: 'questions', attempts: { plan: 2, implement: 1, close_out: 0 } }), 'x');
    const comments = [
      { author: { login: 'bot' }, body: `q ${driver.DRIVER_MARKER}`, createdAt: 'a' },
      { author: { login: 'me' }, body: 'the answer', createdAt: 'b' },
    ];
    const r = run(['requeue', '1'], { queue: fakeQueue({ comments }) });
    assert.equal(r.task.parked, null);
    assert.deepEqual(r.task.attempts, { plan: 0, implement: 0, close_out: 0 });
    assert.deepEqual(r.replies, [{ author: 'me', body: 'the answer' }]);
    assert.throws(() => run(['requeue', '77'], { queue: fakeQueue({ comments }) }), /no driver task/);
  });

  it('finish moves the task and its data directory to done', () => {
    resetState();
    driver.saveTask(state_dir, makeTask(), 'x');
    const data = driver.taskDataDir(state_dir, REPO, 1);
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'plan-result.json'), '{}');
    run(['finish', '1', '--pr', 'https://example.com/pr/1']);
    assert.equal(fs.existsSync(driver.taskPath(state_dir, REPO, 1)), false);
    const done = path.join(state_dir, 'driver', 'done');
    const moved = JSON.parse(fs.readFileSync(path.join(done, 'acme__queue__1.json'), 'utf8'));
    assert.equal(moved.stage, 'done');
    assert.equal(moved.pr_url, 'https://example.com/pr/1');
    assert.ok(fs.existsSync(path.join(done, 'acme__queue__1', 'plan-result.json')));
  });

  it('install-wake copies the launcher and is idempotent', () => {
    resetState();
    const first = run(['install-wake']);
    assert.equal(first.updated, true);
    assert.equal(first.path, path.join(state_dir, 'driver', 'wake.js'));
    assert.equal(
      fs.readFileSync(first.path, 'utf8'),
      fs.readFileSync(path.join(__dirname, '..', 'lib', 'driver-wake.js'), 'utf8'),
    );
    assert.equal(run(['install-wake']).updated, false);
  });

  it('settings prints the parsed preferences', () => {
    resetState();
    writePreferences({ target_repos: { 'a/b': '~/b' } });
    assert.deepEqual(run(['settings'], { home: '/h' }).target_repos, { 'a/b': '/h/b' });
  });

  it('next reports busy for a live foreign lock only', () => {
    resetState();
    const lock = path.join(state_dir, 'driver', wake.LOCK_FILE);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    const q = fakeQueue({}, []);
    assert.equal(run(['next'], { queue: q }).action, 'busy');
    assert.equal(q.calls.length, 0);
    const own = run(['next'], { queue: q, env: { [wake.WAKE_ENV]: String(process.pid) } });
    assert.equal(own.action, 'idle');
    assert.deepEqual(q.calls, [['listQueued', REPO]]);
  });

  it('repeated failed launches without a run reach the retry limit', () => {
    resetState();
    driver.saveTask(state_dir, makeTask({ stage: 'implement' }), 'x');
    for (let i = 0; i < 3; i++) {
      assert.equal(run(['next'], { queue: fakeQueue({}, []) }).action, 'continue');
      run(['patch', '1', '{"attempt":"implement"}']);
    }
    assert.equal(run(['next'], { queue: fakeQueue({}, []) }).action, 'park');
  });

  it('a manual pass holds a pass lock that blocks other sessions until released', () => {
    resetState();
    const q = fakeQueue({}, [{ number: 8, body: issueBody('a/b') }]);
    const lock = path.join(state_dir, 'driver', wake.PASS_LOCK_FILE);
    assert.equal(run(['next', '--session', 's1'], { queue: q }).action, 'start');
    assert.ok(fs.existsSync(lock));
    assert.equal(run(['next', '--session', 's2'], { queue: q }).action, 'busy');
    assert.equal(run(['next', '--session', 's1'], { queue: q }).action, 'start');
    // The launcher's own passes do not take the lock.
    const wake_env = { [wake.WAKE_ENV]: String(process.pid) };
    assert.equal(run(['next', '--session', 's3'], { queue: q, env: wake_env }).action, 'start');
    run(['release']);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(run(['next', '--session', 's2'], { queue: q }).action, 'start');
  });

  it('an expired pass lock no longer blocks', () => {
    resetState();
    const lock = path.join(state_dir, 'driver', wake.PASS_LOCK_FILE);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ session_id: 's1', expires_at: '2000-01-01T00:00:00.000Z' }));
    assert.equal(run(['next', '--session', 's2'], { queue: fakeQueue({}, []) }).action, 'idle');
  });

  it('next lists the queue only without an active task and adds data_dir', () => {
    resetState();
    driver.saveTask(state_dir, makeTask(), 'x');
    const q = fakeQueue({}, [{ number: 8, body: issueBody('a/b') }]);
    const r = run(['next', '--session', 's'], { queue: q });
    assert.equal(r.action, 'continue');
    assert.equal(q.calls.length, 0);
    assert.equal(r.data_dir, driver.taskDataDir(state_dir, REPO, 1));
    resetState();
    const s = run(['next'], { queue: q });
    assert.deepEqual([s.action, s.issue], ['start', 8]);
  });
});
