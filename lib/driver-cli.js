#!/usr/bin/env node
/**
 * CLI: state and decisions for the autonomous workflow driver.
 *
 * The driver skill only acts on the JSON this tool prints. All driver state
 * lives under <state dir>/driver/:
 *   tasks/<owner>__<repo>__<n>.json   one task per issue of the control repo
 *   tasks/<owner>__<repo>__<n>/       data directory for large files
 *   done/                             finished tasks
 *   session, wake.lock                written by the wake launcher (driver-wake.js)
 *   pass.lock                         held by a manual pass until it expires or is released
 *   wake.js                           installed copy of the wake launcher
 *
 * Usage:
 *   node lib/driver-cli.js settings
 *   node lib/driver-cli.js next [--session <id>]
 *   node lib/driver-cli.js start <n>
 *   node lib/driver-cli.js requeue <n>
 *   node lib/driver-cli.js patch <n> '<json>' | --file <path>
 *   node lib/driver-cli.js comment <n> --body-file <path>
 *   node lib/driver-cli.js park <n> <reason> --body-file <path> [--from <label>] [--to <label>]
 *   node lib/driver-cli.js finish <n> --pr <url>
 *   node lib/driver-cli.js release
 *   node lib/driver-cli.js install-wake
 * Every command accepts --repo owner/name (default: CLAUDE_WORKFLOW_CONTROL_REPO).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getStateDir } = require('./paths');
const queue_cli = require('./queue-cli');
const wake = require('./driver-wake');

const { parseTaskSpec, controlRepo, LABELS } = queue_cli;

const DRIVER_MARKER = '<!-- workflow-driver -->';
const STAGES = ['plan', 'implement', 'close_out', 'done'];
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
const PATCH_KEYS = ['stage', 'branch', 'base_branch', 'plan_round', 'answers', 'run', 'pr_url', 'title', 'attempt'];
const DEMO_SKILL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;

// --- Paths and task storage ---------------------------------------------------

function driverDir(state_dir) {
  return path.join(state_dir, 'driver');
}

function taskKey(control_repo, issue_number) {
  return `${String(control_repo).replace(/\//g, '__')}__${issue_number}`;
}

function taskPath(state_dir, control_repo, issue_number) {
  return path.join(driverDir(state_dir), 'tasks', `${taskKey(control_repo, issue_number)}.json`);
}

function taskDataDir(state_dir, control_repo, issue_number) {
  return path.join(driverDir(state_dir), 'tasks', taskKey(control_repo, issue_number));
}

function nowIso(now) {
  if (typeof now === 'function') return nowIso(now());
  if (now instanceof Date) return now.toISOString();
  return now || new Date().toISOString();
}

function loadTask(state_dir, control_repo, issue_number) {
  try {
    return JSON.parse(fs.readFileSync(taskPath(state_dir, control_repo, issue_number), 'utf8'));
  } catch {
    return null;
  }
}

function loadTasks(state_dir) {
  const dir = path.join(driverDir(state_dir), 'tasks');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const tasks = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      const task = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (task && typeof task === 'object' && !Array.isArray(task)) tasks.push(task);
    } catch {
      // A damaged task file is skipped rather than blocking the whole queue.
    }
  }
  return tasks;
}

function saveTask(state_dir, task, now) {
  const file = taskPath(state_dir, task.control_repo, task.issue_number);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  task.updated_at = nowIso(now);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(task, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return task;
}

// --- Settings -----------------------------------------------------------------

function positiveInteger(preferences, key) {
  const value = preferences[key];
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${key} must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function readSettings(preferences, home) {
  const prefs = preferences || {};
  const home_dir = home || os.homedir();

  const target_repos = {};
  if (prefs.target_repos !== undefined) {
    const raw = prefs.target_repos;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
      || !Object.values(raw).every((v) => typeof v === 'string' && v)) {
      throw new TypeError('target_repos must be an object mapping owner/repo to a directory path');
    }
    for (const [slug, dir] of Object.entries(raw)) {
      target_repos[slug] = wake.expandHome(dir, home_dir);
    }
  }

  // null means implement uses its bundled recorder; "none" is passed through and turns the stage off.
  let demo_skill = null;
  if (prefs.demo_skill !== undefined && prefs.demo_skill !== null) {
    if (typeof prefs.demo_skill !== 'string' || !DEMO_SKILL_PATTERN.test(prefs.demo_skill)) {
      throw new TypeError(`demo_skill must be a skill name (got ${JSON.stringify(prefs.demo_skill)})`);
    }
    demo_skill = prefs.demo_skill;
  }

  return {
    target_repos,
    demo_skill,
    max_agents: positiveInteger(prefs, 'driver_max_agents'),
    max_attempts: positiveInteger(prefs, 'driver_max_attempts') || wake.DEFAULT_MAX_ATTEMPTS,
    pass_lock_minutes: positiveInteger(prefs, 'driver_pass_lock_minutes') || wake.DEFAULT_PASS_LOCK_MINUTES,
    judge_fallback: typeof prefs.judge_fallback === 'string' && prefs.judge_fallback ? prefs.judge_fallback : null,
  };
}

// --- Pure helpers ---------------------------------------------------------------

function sortQueued(issues) {
  const rank = (issue) => {
    const i = PRIORITY_ORDER.indexOf(parseTaskSpec(issue.body || '').priority);
    return i === -1 ? PRIORITY_ORDER.length : i;
  };
  return [...issues].sort((a, b) => rank(a) - rank(b) || a.number - b.number);
}

// The branch is pushed to the target repository, so it must not carry the
// control repository's issue number or title: it uses a random suffix only.
function branchName(suffix) {
  return `workflow/task-${suffix || crypto.randomBytes(4).toString('hex')}`;
}

function repliesSince(comments) {
  const list = Array.isArray(comments) ? comments : [];
  let last = -1;
  list.forEach((c, i) => {
    if (String((c && c.body) || '').includes(DRIVER_MARKER)) last = i;
  });
  if (last === -1) return [];
  return list.slice(last + 1)
    .filter((c) => !String((c && c.body) || '').includes(DRIVER_MARKER))
    .map((c) => ({ author: (c.author && c.author.login) || null, body: c.body }));
}

function decide({ tasks, queued, control_repo, session_id, max_attempts, foreign_wake }) {
  if (foreign_wake) return { action: 'busy' };
  const own = (tasks || []).filter((t) => t.control_repo === control_repo);
  const active = own
    .filter((t) => !t.parked && t.stage !== 'done')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (active.length > 0) {
    const t = active[0];
    if (((t.attempts && t.attempts[t.stage]) || 0) >= max_attempts) {
      return { action: 'park', reason: 'retry_limit', task: t };
    }
    if (t.run) {
      return { action: 'resume_run', task: t, same_session: Boolean(session_id) && t.run.session_id === session_id };
    }
    return { action: 'continue', task: t };
  }
  const q = (queued || [])[0];
  if (q) {
    const parked = own.find((t) => t.parked && t.issue_number === q.number);
    return parked
      ? { action: 'requeued', issue: q.number, task: parked }
      : { action: 'start', issue: q.number };
  }
  return { action: 'idle' };
}

// --- Command implementation -----------------------------------------------------

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function hasForeignWake(state_dir, env) {
  const lock = wake.readJson(path.join(driverDir(state_dir), wake.LOCK_FILE));
  if (!Number.isInteger(lock.pid) || !isAlive(lock.pid)) return false;
  return String(lock.pid) !== String(env[wake.WAKE_ENV] || '');
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const with_value = ['--repo', '--session', '--body-file', '--file', '--pr', '--from', '--to'];
  for (let i = 0; i < argv.length; i++) {
    if (with_value.includes(argv[i])) {
      if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`);
      flags[argv[i].slice(2)] = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { flags, positional };
}

function issueNumber(value, usage) {
  const n = parseInt(value, 10);
  if (!n || n < 1) throw new Error(`usage: ${usage}`);
  return n;
}

function readBodyFile(flags, usage) {
  if (!flags['body-file']) throw new Error(`usage: ${usage}`);
  return fs.readFileSync(flags['body-file'], 'utf8');
}

function withMarker(body) {
  return `${String(body).replace(/\s+$/, '')}\n\n${DRIVER_MARKER}`;
}

function requireTask(ctx, n) {
  const task = loadTask(ctx.state_dir, ctx.repo, n);
  if (!task) throw new Error(`no driver task for issue #${n}`);
  return task;
}

function removeSession(state_dir) {
  fs.rmSync(path.join(driverDir(state_dir), wake.SESSION_FILE), { force: true });
}

// A manual pass has no launcher, so it holds a pass lock that expires on its
// own; the launcher skips a wake while the lock is live.
function passLockFile(state_dir) {
  return path.join(driverDir(state_dir), wake.PASS_LOCK_FILE);
}

function hasForeignPass(ctx, session) {
  const lock = wake.readJson(passLockFile(ctx.state_dir));
  const expires = Date.parse(lock.expires_at);
  return Number.isFinite(expires) && expires > Date.parse(nowIso(ctx.now)) && lock.session_id !== session;
}

function takePassLock(ctx, session, minutes) {
  const file = passLockFile(ctx.state_dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const expires = new Date(Date.parse(nowIso(ctx.now)) + minutes * 60000).toISOString();
  fs.writeFileSync(file, JSON.stringify({ session_id: session, expires_at: expires }));
}

function releasePassLock(state_dir) {
  fs.rmSync(passLockFile(state_dir), { force: true });
}

function cmdNext(ctx, flags) {
  const tasks = loadTasks(ctx.state_dir);
  const settings = ctx.settings();
  const is_manual = !ctx.env[wake.WAKE_ENV];
  const session = flags.session || 'manual';
  const foreign_wake = hasForeignWake(ctx.state_dir, ctx.env) || (is_manual && hasForeignPass(ctx, session));
  const base = { tasks, control_repo: ctx.repo, session_id: flags.session || null, max_attempts: settings.max_attempts, foreign_wake };
  let decision = decide({ ...base, queued: [] });
  if (decision.action === 'idle') {
    decision = decide({ ...base, queued: sortQueued(ctx.queue.listQueued(ctx.repo)) });
  }
  if (is_manual && decision.action !== 'busy') {
    if (decision.action === 'idle') releasePassLock(ctx.state_dir);
    else takePassLock(ctx, session, settings.pass_lock_minutes);
  }
  const out = { ...decision, settings };
  if (decision.task) out.data_dir = taskDataDir(ctx.state_dir, ctx.repo, decision.task.issue_number);
  return out;
}

function cmdStart(ctx, n) {
  const issue = ctx.queue.readTask(ctx.repo, n);
  const spec = parseTaskSpec(issue.body || '');
  if (spec._parse_errors.length > 0) return { ok: false, reason: 'parse_error', errors: spec._parse_errors };
  const settings = ctx.settings();
  const repo_path = settings.target_repos[spec.target_repo];
  if (!repo_path) return { ok: false, reason: 'unmapped_repo', target_repo: spec.target_repo };
  if (!isDirectory(repo_path)) return { ok: false, reason: 'missing_path', target_repo: spec.target_repo, repo_path };
  const title = issue.title || '';
  const task = saveTask(ctx.state_dir, {
    control_repo: ctx.repo,
    issue_number: n,
    title,
    target_repo: spec.target_repo,
    repo_path,
    stage: 'plan',
    parked: null,
    branch: branchName(),
    base_branch: null,
    plan_round: 1,
    answers: [],
    attempts: { plan: 0, implement: 0, close_out: 0 },
    run: null,
    pr_url: null,
    created_at: nowIso(ctx.now),
  }, ctx.now);
  const data_dir = taskDataDir(ctx.state_dir, ctx.repo, n);
  fs.mkdirSync(data_dir, { recursive: true });
  return { ok: true, task, spec, data_dir };
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function cmdRequeue(ctx, n) {
  const task = requireTask(ctx, n);
  const replies = repliesSince(ctx.queue.readTask(ctx.repo, n).comments);
  task.parked = null;
  task.attempts = { plan: 0, implement: 0, close_out: 0 };
  saveTask(ctx.state_dir, task, ctx.now);
  return { ok: true, task, replies, data_dir: taskDataDir(ctx.state_dir, ctx.repo, n) };
}

function validatePatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch must be a JSON object');
  const unknown = Object.keys(patch).filter((k) => !PATCH_KEYS.includes(k));
  if (unknown.length > 0) throw new Error(`patch key not allowed: ${unknown.join(', ')}`);
  if (patch.stage !== undefined && !STAGES.includes(patch.stage)) throw new Error(`invalid stage "${patch.stage}"`);
  if (patch.attempt !== undefined && !STAGES.includes(patch.attempt)) throw new Error(`invalid attempt stage "${patch.attempt}"`);
  const run = patch.run;
  if (run !== undefined && run !== null) {
    if (typeof run !== 'object' || Array.isArray(run) || !['plan', 'implement'].includes(run.workflow)
      || typeof run.session_id !== 'string' || !/^[A-Za-z0-9-]+$/.test(run.session_id)) {
      throw new Error('run must be null or { workflow: plan|implement, run_id, session_id }');
    }
  }
}

function cmdPatch(ctx, n, flags, positional) {
  const usage = "patch <n> '<json>' | patch <n> --file <path>";
  const text = flags.file ? fs.readFileSync(flags.file, 'utf8') : positional[2];
  if (!text) throw new Error(`usage: ${usage}`);
  let patch;
  try {
    patch = JSON.parse(text);
  } catch (e) {
    throw new Error(`patch is not valid JSON: ${e.message}`);
  }
  validatePatch(patch);
  const task = requireTask(ctx, n);
  task.attempts = { plan: 0, implement: 0, close_out: 0, ...(task.attempts || {}) };
  const { attempt, ...fields } = patch;
  Object.assign(task, fields);
  if (attempt !== undefined) task.attempts[attempt] = (task.attempts[attempt] || 0) + 1;
  const session_file = path.join(driverDir(ctx.state_dir), wake.SESSION_FILE);
  if (patch.run) {
    fs.mkdirSync(path.dirname(session_file), { recursive: true });
    fs.writeFileSync(session_file, JSON.stringify({ session_id: patch.run.session_id, failed_resumes: 0 }, null, 2));
  } else if (patch.run === null) {
    removeSession(ctx.state_dir);
  }
  saveTask(ctx.state_dir, task, ctx.now);
  return { ok: true, task };
}

function cmdComment(ctx, n, flags) {
  const body = withMarker(readBodyFile(flags, 'comment <n> --body-file <path>'));
  ctx.queue.comment(ctx.repo, n, body);
  return { ok: true, number: n };
}

function cmdPark(ctx, n, flags, positional) {
  const usage = 'park <n> <reason> --body-file <path> [--from <label>] [--to <label>]';
  const reason = positional[2];
  if (!reason) throw new Error(`usage: ${usage}`);
  const body = withMarker(readBodyFile(flags, usage));
  const from = flags.from || LABELS.IN_PROGRESS;
  const to = flags.to || LABELS.BLOCKED;
  ctx.queue.transition(ctx.repo, n, from, to);
  ctx.queue.comment(ctx.repo, n, body);
  const task = loadTask(ctx.state_dir, ctx.repo, n);
  if (task) {
    task.parked = reason;
    task.run = null;
    saveTask(ctx.state_dir, task, ctx.now);
  }
  removeSession(ctx.state_dir);
  releasePassLock(ctx.state_dir);
  return { ok: true, number: n, parked: reason, from, to };
}

function cmdFinish(ctx, n, flags) {
  if (!flags.pr) throw new Error('usage: finish <n> --pr <url>');
  const task = requireTask(ctx, n);
  task.stage = 'done';
  task.pr_url = flags.pr;
  task.run = null;
  saveTask(ctx.state_dir, task, ctx.now);
  removeSession(ctx.state_dir);
  releasePassLock(ctx.state_dir);

  const done_dir = path.join(driverDir(ctx.state_dir), 'done');
  fs.mkdirSync(done_dir, { recursive: true });
  const file = taskPath(ctx.state_dir, ctx.repo, n);
  fs.renameSync(file, path.join(done_dir, path.basename(file)));
  const data_dir = taskDataDir(ctx.state_dir, ctx.repo, n);
  if (isDirectory(data_dir)) {
    const target = path.join(done_dir, path.basename(data_dir));
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(data_dir, target);
  }
  return { ok: true, number: n, pr_url: flags.pr, done_dir };
}

function cmdInstallWake(ctx) {
  const source = fs.readFileSync(path.join(__dirname, 'driver-wake.js'));
  const target = path.join(driverDir(ctx.state_dir), 'wake.js');
  let current = null;
  try {
    current = fs.readFileSync(target);
  } catch {
    // Not installed yet.
  }
  const updated = current === null || !current.equals(source);
  if (updated) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  const log = path.join(path.dirname(target), 'wake.log');
  return {
    path: target,
    updated,
    schedule_example: `0 * * * * PATH="$HOME/.local/bin:<dir of node>:<dir of gh>:/usr/local/bin:$PATH" node "${target}" >> "${log}" 2>&1`,
  };
}

function runCommand(argv, options) {
  const o = options || {};
  const env = o.env || process.env;
  const state_dir = o.state_dir || getStateDir();
  const home = o.home || env.HOME || os.homedir();
  const { flags, positional } = parseArgs(argv);
  const cmd = positional[0];

  const ctx = {
    state_dir,
    env,
    now: o.now,
    queue: o.queue || queue_cli,
    settings: () => readSettings(wake.readJson(path.join(state_dir, 'preferences.json')), home),
  };

  if (cmd === 'install-wake') return cmdInstallWake(ctx);
  if (cmd === 'settings') return ctx.settings();
  if (cmd === 'release') {
    releasePassLock(state_dir);
    return { ok: true };
  }

  const known = ['next', 'start', 'requeue', 'patch', 'comment', 'park', 'finish'];
  if (!known.includes(cmd)) {
    throw new Error('usage: settings | next | start <n> | requeue <n> | patch <n> <json> | comment <n> | park <n> <reason> | finish <n> | release | install-wake');
  }
  ctx.repo = controlRepo({ repo: flags.repo || env.CLAUDE_WORKFLOW_CONTROL_REPO });
  if (cmd === 'next') return cmdNext(ctx, flags);

  const n = issueNumber(positional[1], `${cmd} <number>`);
  switch (cmd) {
    case 'start': return cmdStart(ctx, n);
    case 'requeue': return cmdRequeue(ctx, n);
    case 'patch': return cmdPatch(ctx, n, flags, positional);
    case 'comment': return cmdComment(ctx, n, flags);
    case 'park': return cmdPark(ctx, n, flags, positional);
    default: return cmdFinish(ctx, n, flags);
  }
}

function fail(msg) {
  process.stderr.write(`driver: ${msg}\n`);
  process.exit(2);
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(runCommand(process.argv.slice(2)), null, 2) + '\n');
  } catch (e) {
    fail(e.message);
  }
}

module.exports = {
  DRIVER_MARKER,
  taskPath,
  taskDataDir,
  loadTasks,
  loadTask,
  saveTask,
  readSettings,
  sortQueued,
  branchName,
  repliesSince,
  decide,
  runCommand,
};
