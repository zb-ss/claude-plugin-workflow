/**
 * Tests for lib/tier-setup.js: the startup setup check, the consent-based write
 * helpers and the CLI. Every test works in its own temp dir; nothing touches the
 * real ~/.claude or ~/.claude-workflows.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const T = require('../lib/tier-setup.js');

const CLI = path.join(__dirname, '..', 'lib', 'tier-setup.js');
const FULL_LINE = 'workflow plugin setup: model tier block missing from the global CLAUDE.md; '
  + 'default model is not opus; scrub denylist cannot be read. Run /workflow:setup to fix or dismiss.';

let roots = [];
before(() => { roots = []; });
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function makeEnv(denylist) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-setup-'));
  roots.push(root);
  const configDir = path.join(root, 'config');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(configDir);
  fs.mkdirSync(stateDir);
  const env = { CLAUDE_CONFIG_DIR: configDir, CLAUDE_WORKFLOW_STATE_DIR: stateDir };
  if (denylist) env.CLAUDE_WORKFLOW_SCRUB_DENYLIST = denylist;
  return { root, configDir, stateDir, env };
}

const check = (c) => T.checkSetup({ env: c.env, configDir: c.configDir, stateDir: c.stateDir });
const writeMd = (c, text) => fs.writeFileSync(path.join(c.configDir, 'CLAUDE.md'), text);
const writeSettings = (c, obj) => fs.writeFileSync(path.join(c.configDir, 'settings.json'), JSON.stringify(obj));
const OLD_BLOCK = '<!-- workflow-plugin:tiers v0 -->\nold text\n<!-- /workflow-plugin:tiers -->';

function setAllGood(c) {
  writeMd(c, T.TIER_BLOCK + '\n');
  writeSettings(c, { model: 'opus' });
}

describe('block constants', () => {
  it('has the version-1 markers as first and last line', () => {
    assert.equal(T.TIER_BLOCK_VERSION, 1);
    const lines = T.TIER_BLOCK.split('\n');
    assert.equal(lines[0], '<!-- workflow-plugin:tiers v1 -->');
    assert.equal(lines[lines.length - 1], '<!-- /workflow-plugin:tiers -->');
    assert.equal(T.START_MARKER, lines[0]);
    assert.equal(T.END_MARKER, lines[lines.length - 1]);
  });

  // Pins the whole text: a wording change must come with a TIER_BLOCK_VERSION bump.
  it('is exactly the published version-1 block', () => {
    assert.equal(T.TIER_BLOCK, [
      '<!-- workflow-plugin:tiers v1 -->',
      '## Model tiers (workflow plugin)',
      '',
      '- Orchestrator: the main session, on `opus`. It plans the run, talks to the user and delegates; it does not do worker or judge work itself.',
      '- Judge (`fable`, falls back to `opus`): planning judgement, architecture, code and security review, completion sign-off.',
      '- Worker (`sonnet`): exploration, coding from a plan, tests, fixes, verification of findings.',
      '- Mechanical (`haiku`): scoping a review, merging duplicate findings.',
      '',
      'For code changes, reach for the saved workflows instead of doing the work inline:',
      '- `/workflow:do <task>`: plan, questions, implement, review and sign-off in one go.',
      '- `/workflow:plan`, `/workflow:implement`, `/workflow:review`: one stage at a time.',
      '<!-- /workflow-plugin:tiers -->',
    ].join('\n'));
    assert.ok(T.TIER_BLOCK.split('\n').length <= 15);
  });
});

describe('checkSetup', () => {
  it('is silent with current block, opus model and no denylist', () => {
    const c = makeEnv();
    setAllGood(c);
    assert.deepEqual(check(c), []);
    assert.equal(T.formatReminder([]), '');
  });

  it('is silent with a loaded denylist', () => {
    const dl = makeEnv();
    const file = path.join(dl.root, 'denylist.json');
    fs.writeFileSync(file, '{"entries": []}');
    const c = makeEnv(file);
    setAllGood(c);
    assert.deepEqual(check(c), []);
  });

  it('prints the exact one-line reminder for an empty config dir', () => {
    const base = makeEnv();
    const c = makeEnv(path.join(base.root, 'missing.json'));
    const line = T.formatReminder(check(c));
    assert.equal(line, FULL_LINE);
    assert.ok(!line.includes('\n'));
  });

  it('reports each item alone', () => {
    const c = makeEnv();
    writeSettings(c, { model: 'opus' });
    assert.deepEqual(check(c), ['model tier block missing from the global CLAUDE.md']);

    const d = makeEnv();
    writeMd(d, T.TIER_BLOCK);
    assert.deepEqual(check(d), ['default model is not opus']);

    const e = makeEnv(path.join(d.root, 'nope.json'));
    setAllGood(e);
    assert.deepEqual(check(e), ['scrub denylist cannot be read']);
  });

  it('judges the model by substring', () => {
    const c = makeEnv();
    writeMd(c, T.TIER_BLOCK);
    writeSettings(c, { model: 'sonnet' });
    assert.deepEqual(check(c), ['default model is not opus']);
    writeSettings(c, { model: 'claude-opus-4' });
    assert.deepEqual(check(c), []);
  });

  it('reports an outdated block', () => {
    const c = makeEnv();
    writeMd(c, OLD_BLOCK + '\n');
    writeSettings(c, { model: 'opus' });
    assert.deepEqual(check(c), ['model tier block in the global CLAUDE.md is outdated']);
  });

  it('silences items a and b after decline but still reports c', () => {
    const c = makeEnv(path.join(os.tmpdir(), 'tier-setup-does-not-exist.json'));
    T.decline(c.stateDir);
    assert.deepEqual(check(c), ['scrub denylist cannot be read']);
  });

  it('reports a and b again when the declined version is below the current one', () => {
    const c = makeEnv();
    fs.writeFileSync(path.join(c.stateDir, 'preferences.json'), '{"tier_block_declined_version": 0}');
    assert.deepEqual(check(c), [
      'model tier block missing from the global CLAUDE.md',
      'default model is not opus',
    ]);
  });
});

describe('preferences writes', () => {
  it('decline and setFallbackPreference keep unrelated keys', () => {
    const c = makeEnv();
    const file = path.join(c.stateDir, 'preferences.json');
    fs.writeFileSync(file, '{"other": 1}');
    T.decline(c.stateDir);
    T.setFallbackPreference(c.stateDir, 'sonnet');
    const prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(prefs, { other: 1, tier_block_declined_version: 1, judge_fallback: 'sonnet' });
    assert.equal(typeof prefs.judge_fallback, 'string');
  });

  it('setFallbackPreference rejects values the workflows would reject', () => {
    const c = makeEnv();
    for (const bad of ['Sonnet 4.5', '', '-x', 5, null]) {
      assert.throws(() => T.setFallbackPreference(c.stateDir, bad), /judge_fallback must be/);
    }
    assert.ok(!fs.existsSync(path.join(c.stateDir, 'preferences.json')));
    T.setFallbackPreference(c.stateDir, 'none');
  });
});

describe('applyBlock', () => {
  it('replaces an older block and leaves the surrounding bytes identical', () => {
    const c = makeEnv();
    const file = path.join(c.configDir, 'CLAUDE.md');
    const prefix = Buffer.from('# Mine é\n\nkeep this\n\n', 'utf8');
    const suffix = Buffer.from('\n\nafter \xff\xfe bytes\n', 'latin1');
    fs.writeFileSync(file, Buffer.concat([prefix, Buffer.from(OLD_BLOCK), suffix]));
    T.applyBlock(file);
    const out = fs.readFileSync(file);
    assert.ok(out.subarray(0, prefix.length).equals(prefix));
    assert.ok(out.subarray(out.length - suffix.length).equals(suffix));
    assert.equal(out.toString('latin1').split('<!-- workflow-plugin:tiers v1 -->').length - 1, 1);
    assert.ok(out.toString('utf8').includes(T.TIER_BLOCK));
  });

  it('is not widened by an orphan start marker', () => {
    const c = makeEnv();
    const file = path.join(c.configDir, 'CLAUDE.md');
    const prefix = 'top\n<!-- workflow-plugin:tiers v1 -->\norphan\n';
    fs.writeFileSync(file, prefix + OLD_BLOCK + '\n');
    T.applyBlock(file);
    assert.ok(fs.readFileSync(file, 'utf8').startsWith(prefix + T.TIER_BLOCK));
  });

  it('appends after one blank line when no markers exist', () => {
    const c = makeEnv();
    const file = path.join(c.configDir, 'CLAUDE.md');
    for (const original of ['# Mine', '# Mine\n', '# Mine\n\n']) {
      fs.writeFileSync(file, original);
      T.applyBlock(file);
      assert.equal(fs.readFileSync(file, 'utf8'), '# Mine\n\n' + T.TIER_BLOCK + '\n');
    }
    fs.writeFileSync(file, 'x\n');
    T.applyBlock(file);
    assert.ok(fs.readFileSync(file, 'utf8').startsWith('x\n\n'));
  });

  it('creates a missing file and directory', () => {
    const c = makeEnv();
    const file = path.join(c.root, 'new', 'dir', 'CLAUDE.md');
    T.applyBlock(file);
    assert.equal(fs.readFileSync(file, 'utf8'), T.TIER_BLOCK + '\n');
  });

  it('writes through a symlinked CLAUDE.md', (t) => {
    const c = makeEnv();
    const target = path.join(c.root, 'target.md');
    const link = path.join(c.configDir, 'CLAUDE.md');
    fs.writeFileSync(target, '# Shared\n');
    try {
      fs.symlinkSync(target, link);
    } catch (err) {
      if (err.code === 'EPERM') return t.skip('symlinks not permitted');
      throw err;
    }
    T.applyBlock(link);
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(fs.readFileSync(target, 'utf8'), '# Shared\n\n' + T.TIER_BLOCK + '\n');
  });
});

describe('addUserFallbackModel', () => {
  it('keeps other keys', () => {
    const c = makeEnv();
    const file = path.join(c.configDir, 'settings.json');
    fs.writeFileSync(file, '{"model":"opus","nested":{"a":1}}');
    T.addUserFallbackModel(file, ['sonnet']);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
      model: 'opus', nested: { a: 1 }, fallbackModel: ['sonnet'],
    });
  });

  it('creates a missing file', () => {
    const c = makeEnv();
    const file = path.join(c.configDir, 'sub', 'settings.json');
    T.addUserFallbackModel(file, ['sonnet', 'haiku']);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { fallbackModel: ['sonnet', 'haiku'] });
  });

  it('throws on invalid JSON and leaves the file unchanged', () => {
    const c = makeEnv();
    const file = path.join(c.configDir, 'settings.json');
    fs.writeFileSync(file, '{ not json');
    assert.throws(() => T.addUserFallbackModel(file, ['sonnet']), /settings\.json/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
  });

  it('writes through a symlinked settings.json and keeps its mode', (t) => {
    const c = makeEnv();
    const target = path.join(c.root, 'target.json');
    const link = path.join(c.configDir, 'settings.json');
    fs.writeFileSync(target, '{"a":1}', { mode: 0o600 });
    fs.chmodSync(target, 0o600);
    try {
      fs.symlinkSync(target, link);
    } catch (err) {
      if (err.code === 'EPERM') return t.skip('symlinks not permitted');
      throw err;
    }
    T.addUserFallbackModel(link, ['sonnet']);
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { a: 1, fallbackModel: ['sonnet'] });
    if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  });
});

describe('CLI', () => {
  function run(c, args) {
    const env = Object.assign({}, process.env, c.env);
    delete env.CLAUDE_WORKFLOW_SCRUB_DENYLIST;
    return spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  }

  it('status prints JSON', () => {
    const c = makeEnv();
    const r = run(c, ['status']);
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.items));
    assert.equal(parsed.installed_block_version, null);
    assert.deepEqual(parsed.preferences, {});
  });

  it('show prints the block exactly', () => {
    const r = run(makeEnv(), ['show']);
    assert.equal(r.stdout, T.TIER_BLOCK + '\n');
  });

  it('apply, decline, set-fallback and add-fallback-model each write once', () => {
    const c = makeEnv();
    assert.equal(run(c, ['apply']).status, 0);
    assert.ok(fs.readFileSync(path.join(c.configDir, 'CLAUDE.md'), 'utf8').includes(T.TIER_BLOCK));
    assert.equal(run(c, ['decline']).status, 0);
    assert.equal(run(c, ['set-fallback', 'sonnet']).status, 0);
    const prefs = JSON.parse(fs.readFileSync(path.join(c.stateDir, 'preferences.json'), 'utf8'));
    assert.deepEqual(prefs, { tier_block_declined_version: 1, judge_fallback: 'sonnet' });
    assert.equal(run(c, ['add-fallback-model', 'sonnet, haiku,']).status, 0);
    const settings = JSON.parse(fs.readFileSync(path.join(c.configDir, 'settings.json'), 'utf8'));
    assert.deepEqual(settings.fallbackModel, ['sonnet', 'haiku']);
  });

  it('exits non-zero with a tier-setup message on usage errors', () => {
    const c = makeEnv();
    for (const args of [[], ['bogus'], ['set-fallback'], ['set-fallback', 'Sonnet 4.5'], ['set-fallback', 'Sonnet', '4.5'], ['add-fallback-model', ' , ']]) {
      const r = run(c, args);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /^tier-setup: /);
      assert.ok(!r.stderr.includes('    at '));
    }
  });
});

describe('tier-check hook', () => {
  const HOOK = path.join(__dirname, '..', 'hooks', 'tier-check.js');
  const HOOKS_JSON = path.join(__dirname, '..', 'hooks', 'hooks.json');

  function runHook(c, overrides) {
    const env = Object.assign({}, process.env, {
      CLAUDE_CONFIG_DIR: c.configDir,
      CLAUDE_WORKFLOW_STATE_DIR: c.stateDir,
    }, overrides);
    // Never inherit the developer's real denylist.
    if (!overrides || !overrides.CLAUDE_WORKFLOW_SCRUB_DENYLIST) delete env.CLAUDE_WORKFLOW_SCRUB_DENYLIST;
    return spawnSync(process.execPath, [HOOK], { input: '{}', encoding: 'utf8', env });
  }

  it('prints nothing when everything is set', () => {
    const c = makeEnv();
    T.applyBlock(path.join(c.configDir, 'CLAUDE.md'));
    writeSettings(c, { model: 'opus' });
    const r = runHook(c);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
  });

  it('prints exactly one reminder line for an empty config dir', () => {
    const c = makeEnv();
    const r = runHook(c);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^workflow plugin setup: .+\. Run \/workflow:setup to fix or dismiss\.\n$/);
  });

  it('exits 0 silently when the config dir is a regular file', () => {
    const c = makeEnv();
    const file = path.join(c.root, 'not-a-dir');
    fs.writeFileSync(file, 'x');
    const r = runHook({ configDir: file, stateDir: c.stateDir });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  it('writes no file in the state dir', () => {
    const c = makeEnv();
    runHook(c);
    assert.deepEqual(fs.readdirSync(c.stateDir), []);
  });

  it('is registered second under SessionStart, existing entry unchanged', () => {
    const entries = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8')).hooks.SessionStart;
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], {
      matcher: 'startup|resume',
      hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js"', timeout: 5 }],
    });
    assert.deepEqual(entries[1], {
      matcher: 'startup',
      hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/tier-check.js"', timeout: 5 }],
    });
  });
});
