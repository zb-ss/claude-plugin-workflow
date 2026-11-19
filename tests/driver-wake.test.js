'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn: realSpawn } = require('child_process');

const wake = require('../lib/driver-wake.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-wake-'));
const driverDir = path.join(tmp, 'driver');
const children = [];

function env() {
  return { PATH: process.env.PATH, HOME: tmp, CLAUDE_WORKFLOW_STATE_DIR: tmp };
}

function fakeSpawn(status, onRun) {
  const calls = [];
  const fn = (command, args, options) => {
    calls.push({ command, args, options });
    if (onRun) onRun();
    return { status };
  };
  fn.calls = calls;
  return fn;
}

function run(spawn) {
  return wake.runWake({ env: env(), spawn, log: () => {} });
}

function writePointer(obj) {
  fs.mkdirSync(driverDir, { recursive: true });
  fs.writeFileSync(path.join(driverDir, wake.SESSION_FILE), JSON.stringify(obj));
}

function readPointer() {
  return wake.readJson(path.join(driverDir, wake.SESSION_FILE));
}

function writePrefs(obj) {
  fs.writeFileSync(path.join(tmp, 'preferences.json'), JSON.stringify(obj));
}

describe('driver-wake', () => {
  beforeEach(() => {
    fs.rmSync(driverDir, { recursive: true, force: true });
    fs.rmSync(path.join(tmp, 'preferences.json'), { force: true });
  });

  after(() => {
    for (const c of children) c.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('starts a fresh session with the wake environment', () => {
    const spawn = fakeSpawn(0);
    assert.equal(run(spawn), 0);
    const { args, options } = spawn.calls[0];
    assert.deepEqual(args, ['-p', '/workflow:auto']);
    assert.equal(options.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, '0');
    assert.equal(options.cwd, driverDir);
    assert.equal(options.env[wake.WAKE_ENV], String(process.pid));
  });

  it('resumes the session named by the pointer', () => {
    writePointer({ session_id: 'abc-123' });
    const spawn = fakeSpawn(0);
    run(spawn);
    assert.deepEqual(spawn.calls[0].args.slice(0, 4), ['-p', '/workflow:auto', '--resume', 'abc-123']);
  });

  it('ignores a pointer with an unsafe session id', () => {
    writePointer({ session_id: 'x; rm' });
    const spawn = fakeSpawn(0);
    run(spawn);
    assert.deepEqual(spawn.calls[0].args, ['-p', '/workflow:auto']);
  });

  it('adds only existing target repos as --add-dir', () => {
    const repo = path.join(tmp, 'repo-a');
    fs.mkdirSync(repo);
    writePrefs({ target_repos: { a: repo, b: path.join(tmp, 'missing') } });
    const spawn = fakeSpawn(0);
    run(spawn);
    assert.deepEqual(spawn.calls[0].args, ['-p', '/workflow:auto', '--add-dir', repo]);
  });

  it('appends driver_claude_args', () => {
    writePrefs({ driver_claude_args: ['--model', 'opus'] });
    const spawn = fakeSpawn(0);
    run(spawn);
    assert.deepEqual(spawn.calls[0].args, ['-p', '/workflow:auto', '--model', 'opus']);
  });

  it('does not spawn while a live foreign lock exists', () => {
    const child = realSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    children.push(child);
    fs.mkdirSync(driverDir, { recursive: true });
    fs.writeFileSync(path.join(driverDir, wake.LOCK_FILE), JSON.stringify({ pid: child.pid }));
    const spawn = fakeSpawn(0);
    assert.equal(run(spawn), 0);
    assert.equal(spawn.calls.length, 0);
  });

  it('replaces a stale lock and removes it afterwards', () => {
    const child = realSpawn(process.execPath, ['-e', '']);
    return new Promise((resolve) => child.on('exit', resolve)).then(() => {
      fs.mkdirSync(driverDir, { recursive: true });
      const lock = path.join(driverDir, wake.LOCK_FILE);
      fs.writeFileSync(lock, JSON.stringify({ pid: child.pid }));
      const spawn = fakeSpawn(0);
      run(spawn);
      assert.equal(spawn.calls.length, 1);
      assert.equal(fs.existsSync(lock), false);
    });
  });

  it('counts failed resumes and drops the pointer at the limit', () => {
    writePrefs({ driver_max_attempts: 2 });
    writePointer({ session_id: 'abc-123' });
    assert.equal(run(fakeSpawn(1)), 1);
    assert.equal(readPointer().failed_resumes, 1);
    run(fakeSpawn(1));
    assert.equal(fs.existsSync(path.join(driverDir, wake.SESSION_FILE)), false);
  });

  it('resets failed resumes after a successful wake', () => {
    writePointer({ session_id: 'abc-123', failed_resumes: 1 });
    run(fakeSpawn(0));
    assert.equal(readPointer().failed_resumes, 0);
  });

  it('logs a spawn error and leaves the pointer alone', () => {
    writePrefs({ driver_max_attempts: 1 });
    writePointer({ session_id: 'abc-123' });
    const messages = [];
    const spawn = () => ({ status: null, error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
    assert.equal(wake.runWake({ env: env(), spawn, log: (m) => messages.push(m) }), 1);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /ENOENT/);
    assert.match(messages[0], /CLAUDE_WORKFLOW_CLAUDE_BIN/);
    assert.equal(readPointer().session_id, 'abc-123');
    assert.equal(readPointer().failed_resumes, undefined);
  });

  it('does not spawn while a manual pass lock is live, and ignores an expired one', () => {
    fs.mkdirSync(driverDir, { recursive: true });
    const lock = path.join(driverDir, wake.PASS_LOCK_FILE);
    fs.writeFileSync(lock, JSON.stringify({ session_id: 's', expires_at: new Date(Date.now() + 60000).toISOString() }));
    const blocked = fakeSpawn(0);
    assert.equal(run(blocked), 0);
    assert.equal(blocked.calls.length, 0);
    fs.writeFileSync(lock, JSON.stringify({ session_id: 's', expires_at: '2000-01-01T00:00:00.000Z' }));
    const allowed = fakeSpawn(0);
    run(allowed);
    assert.equal(allowed.calls.length, 1);
  });

  it('does not recreate a pointer the session removed', () => {
    writePointer({ session_id: 'abc-123' });
    const pointer = path.join(driverDir, wake.SESSION_FILE);
    run(fakeSpawn(1, () => fs.rmSync(pointer)));
    assert.equal(fs.existsSync(pointer), false);
  });

  it('expands a leading home reference', () => {
    assert.equal(wake.expandHome('~/a', '/h'), path.join('/h', 'a'));
    assert.equal(wake.expandHome('$HOME/a', '/h'), path.join('/h', 'a'));
    assert.equal(wake.expandHome('${HOME}/a', '/h'), path.join('/h', 'a'));
    assert.equal(wake.expandHome('/x/a', '/h'), '/x/a');
  });

  it('requires only Node built-ins', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'driver-wake.js'), 'utf8');
    assert.ok(!src.includes("require('./"));
    assert.ok(!src.includes("require('../"));
  });
});
