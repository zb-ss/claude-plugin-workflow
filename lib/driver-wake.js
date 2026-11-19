#!/usr/bin/env node
'use strict';
/**
 * Wake launcher for the autonomous workflow driver.
 *
 * A local scheduler (cron, systemd timer, Task Scheduler) runs this script
 * once per wake. It is copied to <state dir>/driver/wake.js, so it is
 * self-contained: Node built-ins only, never a sibling file.
 *
 * One wake = one headless `claude -p "/workflow:auto"` session. The launcher
 * holds a lock so wakes never overlap, resumes the previous session when the
 * driver left a workflow run unfinished, and gives up on a session pointer
 * after a configured number of failed resumes.
 *
 * Exports (for tests):
 *   SESSION_FILE, LOCK_FILE, PASS_LOCK_FILE, WAKE_ENV, DEFAULT_MAX_ATTEMPTS,
 *   DEFAULT_PASS_LOCK_MINUTES, PROMPT
 *   stateDir(env), expandHome(p, home), readJson(file)
 *   buildArgs({ session_id, add_dirs, claude_args })
 *   runWake({ env, spawn, log }) -> exit status
 *
 * Usage:
 *   node wake.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SESSION_FILE = 'session';
const LOCK_FILE = 'wake.lock';
const WAKE_ENV = 'CLAUDE_WORKFLOW_DRIVER_WAKE_PID';
const PASS_LOCK_FILE = 'pass.lock';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_PASS_LOCK_MINUTES = 240;
const PROMPT = '/workflow:auto';
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]+$/;

function stateDir(env) {
  const e = env || process.env;
  if (e.CLAUDE_WORKFLOW_STATE_DIR) {
    return path.resolve(e.CLAUDE_WORKFLOW_STATE_DIR);
  }
  return path.join(os.homedir(), '.claude-workflows');
}

function expandHome(p, home) {
  const value = String(p);
  const match = /^(?:~|\$HOME|\$\{HOME\})(?=\/)/.exec(value);
  if (!match) return value;
  return path.join(home, value.slice(match[0].length));
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildArgs({ session_id, add_dirs, claude_args }) {
  // The prompt stays right after -p because --add-dir takes several values.
  return [
    '-p',
    PROMPT,
    ...(session_id ? ['--resume', session_id] : []),
    ...(add_dirs || []).flatMap((d) => ['--add-dir', d]),
    ...(claude_args || []),
  ];
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readSessionId(pointer) {
  return typeof pointer.session_id === 'string' && SESSION_ID_PATTERN.test(pointer.session_id)
    ? pointer.session_id
    : null;
}

function readSettings(root, env) {
  const prefs = readJson(path.join(root, 'preferences.json'));
  const home = env.HOME || os.homedir();
  const repos = prefs.target_repos && typeof prefs.target_repos === 'object' && !Array.isArray(prefs.target_repos)
    ? Object.values(prefs.target_repos)
    : [];
  const add_dirs = repos
    .filter((v) => typeof v === 'string' && v)
    .map((v) => expandHome(v, home))
    .filter(isDirectory);
  const claude_args = Array.isArray(prefs.driver_claude_args) && prefs.driver_claude_args.every((a) => typeof a === 'string')
    ? prefs.driver_claude_args
    : [];
  const max_attempts = Number.isInteger(prefs.driver_max_attempts) && prefs.driver_max_attempts > 0
    ? prefs.driver_max_attempts
    : DEFAULT_MAX_ATTEMPTS;
  return { add_dirs, claude_args, max_attempts };
}

function updatePointer(pointer_file, resumed_id, status, max_attempts) {
  if (!resumed_id) return;
  const pointer = readJson(pointer_file);
  if (readSessionId(pointer) !== resumed_id) return;
  const failed = Number.isInteger(pointer.failed_resumes) ? pointer.failed_resumes : 0;
  if (status !== 0) {
    const next = failed + 1;
    if (next >= max_attempts) {
      fs.rmSync(pointer_file, { force: true });
    } else {
      fs.writeFileSync(pointer_file, JSON.stringify({ ...pointer, failed_resumes: next }, null, 2));
    }
  } else if (failed > 0) {
    fs.writeFileSync(pointer_file, JSON.stringify({ ...pointer, failed_resumes: 0 }, null, 2));
  }
}

function runWake({ env, spawn, log }) {
  const root = stateDir(env);
  const driver_dir = path.join(root, 'driver');
  fs.mkdirSync(driver_dir, { recursive: true });

  const lock_file = path.join(driver_dir, LOCK_FILE);
  const lock = readJson(lock_file);
  if (Number.isInteger(lock.pid) && lock.pid !== process.pid && isAlive(lock.pid)) {
    log('a wake is still running');
    return 0;
  }
  const pass = readJson(path.join(driver_dir, PASS_LOCK_FILE));
  if (Date.parse(pass.expires_at) > Date.now()) {
    log('a manual pass is running');
    return 0;
  }
  fs.writeFileSync(lock_file, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));

  try {
    const { add_dirs, claude_args, max_attempts } = readSettings(root, env);
    const pointer_file = path.join(driver_dir, SESSION_FILE);
    const session_id = readSessionId(readJson(pointer_file));

    const bin = env.CLAUDE_WORKFLOW_CLAUDE_BIN || 'claude';
    const result = spawn(
      bin,
      buildArgs({ session_id, add_dirs, claude_args }),
      {
        cwd: driver_dir,
        stdio: 'inherit',
        env: { ...env, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0', [WAKE_ENV]: String(process.pid) },
        shell: process.platform === 'win32',
      }
    );
    if (result && result.error) {
      // The session was never tried, so the pointer and its failure count stay as they are.
      log(`could not start ${bin}: ${result.error.code || result.error.message}. `
        + 'Put it on the scheduler\'s PATH or set CLAUDE_WORKFLOW_CLAUDE_BIN to its full path.');
      return 1;
    }
    const status = result && typeof result.status === 'number' ? result.status : null;
    updatePointer(pointer_file, session_id, status === null ? 1 : status, max_attempts);
    return status === null ? 1 : status;
  } finally {
    fs.rmSync(lock_file, { force: true });
  }
}

module.exports = {
  SESSION_FILE,
  LOCK_FILE,
  PASS_LOCK_FILE,
  WAKE_ENV,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_PASS_LOCK_MINUTES,
  PROMPT,
  stateDir,
  expandHome,
  readJson,
  buildArgs,
  runWake,
};

if (require.main === module) {
  process.exit(runWake({ env: process.env, spawn: spawnSync, log: (m) => process.stderr.write(m + '\n') }));
}
