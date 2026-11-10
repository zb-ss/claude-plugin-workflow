/**
 * Tests for statusline/statusline.js and statusline/reset-cache.js — the
 * stdin-only default path, the reset cache contract with
 * hooks/lib/rate-limit.js, and input robustness.
 *
 * All state lives under a temp root; nothing touches ~/.claude,
 * ~/.claude-workflows, the real tmp cache or the network.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { run } = require('../statusline/statusline.js');
const { resolveResetCacheFile, toIsoString } = require('../statusline/reset-cache.js');
const { readStatuslineCache, getNextResetIso } = require('../hooks/lib/rate-limit.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'statusline', 'statusline.js');
const PROBE = path.join(__dirname, 'statusline-probe.js');

const NOW_MS = Date.UTC(2099, 0, 1);
const NOW_S = NOW_MS / 1000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

let tmp_root;
let state_dir;
let saved_state_dir;
let saved_cache_env;
let case_counter = 0;

function freshCacheFile() {
  case_counter += 1;
  return path.join(tmp_root, `cache-${case_counter}.json`);
}

function fullSession(overrides = {}) {
  return Object.assign({
    model: { display_name: 'Opus' },
    context_window: { used_percentage: 42 },
    cost: { total_cost_usd: 0.12 },
    rate_limits: {
      five_hour: { used_percentage: 52, resets_at: NOW_S + 9000 },
      seven_day: { used_percentage: 35, resets_at: NOW_S + 3 * 86400 + 3600 },
    },
  }, overrides);
}

function runLine(session, extra = {}) {
  return run(Object.assign({
    stdin_text: typeof session === 'string' ? session : JSON.stringify(session),
    now_ms: NOW_MS,
    reset_cache_file: freshCacheFile(),
  }, extra));
}

function runChild(stdin, extra_env = {}) {
  const home = path.join(tmp_root, 'home');
  const child_tmp = path.join(tmp_root, 'child-tmp');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(child_tmp, { recursive: true });
  fs.writeFileSync(
    path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'filetok' } }),
  );
  const probe_log = path.join(tmp_root, `probe-${++case_counter}.json`);
  const result = spawnSync(process.execPath, ['--require', PROBE, SCRIPT], {
    cwd: REPO_ROOT,
    input: stdin,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      HOME: home,
      USERPROFILE: home,
      TMPDIR: child_tmp,
      TEMP: child_tmp,
      TMP: child_tmp,
      CLAUDE_WORKFLOW_STATE_DIR: state_dir,
      CLAUDE_STATUSLINE_CACHE: path.join(tmp_root, `child-cache-${case_counter}.json`),
      STATUSLINE_PROBE_LOG: probe_log,
    }, extra_env),
  });
  let events = null;
  try { events = JSON.parse(fs.readFileSync(probe_log, 'utf8')); } catch { /* reported by asserts */ }
  return Object.assign(result, { events });
}

before(() => {
  tmp_root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-statusline-'));
  saved_state_dir = process.env.CLAUDE_WORKFLOW_STATE_DIR;
  saved_cache_env = process.env.CLAUDE_STATUSLINE_CACHE;
  state_dir = path.join(tmp_root, 'state');
  fs.mkdirSync(state_dir, { recursive: true });
  process.env.CLAUDE_WORKFLOW_STATE_DIR = state_dir;
  process.env.CLAUDE_STATUSLINE_CACHE = path.join(tmp_root, 'cache.json');
});

after(() => {
  if (saved_state_dir === undefined) delete process.env.CLAUDE_WORKFLOW_STATE_DIR;
  else process.env.CLAUDE_WORKFLOW_STATE_DIR = saved_state_dir;
  if (saved_cache_env === undefined) delete process.env.CLAUDE_STATUSLINE_CACHE;
  else process.env.CLAUDE_STATUSLINE_CACHE = saved_cache_env;
  fs.rmSync(tmp_root, { recursive: true, force: true });
});

describe('statusline rendering from stdin', () => {
  it('renders the golden line', async () => {
    const line = await runLine(fullSession());
    assert.equal(
      stripAnsi(line),
      'Opus │ 5h █████░░░░░  52% 2h30m │ 7d ████░░░░░░  35% 3d │ ctx ████░░░░░░  42% │ $0.12',
    );
  });

  it('keeps the raw 5h segment format', async () => {
    const line = await runLine(fullSession());
    const raw = '\x1b[2m5h\x1b[0m \x1b[32m█████\x1b[2m░░░░░\x1b[0m \x1b[32m 52%\x1b[0m \x1b[2m2h30m\x1b[0m';
    assert.ok(line.includes(raw));
  });
});

describe('statusline segments and order', () => {
  it('renders ctx, cost and model alone', async () => {
    const line = await runLine({
      model: { display_name: 'Sonnet' },
      context_window: { used_percentage: 80 },
      cost: { total_cost_usd: 3 },
    });
    assert.equal(stripAnsi(line), 'Sonnet │ ctx ████████░░  80% │ $3.00');
  });

  describe('i18n translate segment', () => {
    const workflow_dir = () => path.join(state_dir, 'translate', 'x-translate-y');

    before(() => {
      fs.mkdirSync(workflow_dir(), { recursive: true });
      fs.writeFileSync(path.join(workflow_dir(), 'workflow-state.json'), JSON.stringify({
        status: 'processing',
        componentName: 'com_test',
        updated: new Date().toISOString(),
        views: [{ status: 'done' }, { status: 'pending' }],
      }));
    });

    after(() => {
      fs.rmSync(path.join(state_dir, 'translate'), { recursive: true, force: true });
    });

    it('renders workflow progress last', async () => {
      const line = await runLine({ model: { display_name: 'Opus' } });
      assert.equal(stripAnsi(line), 'Opus │ i18n com_test ████░░░░ 1/2');
    });
  });
});

describe('default path reads no credentials and makes no network call', () => {
  it('never calls fetch_usage when the switch file is missing', async () => {
    let calls = 0;
    const line = await runLine(fullSession(), {
      settings_file: path.join(tmp_root, 'no-such-statusline.json'),
      fetch_usage: async () => { calls += 1; return null; },
    });
    assert.equal(calls, 0);
    assert.ok(line.length > 0);
  });

  it('child process makes no credential read or network call', () => {
    const reset_s = Math.floor(Date.now() / 1000);
    const stdin = JSON.stringify(fullSession({
      rate_limits: {
        five_hour: { used_percentage: 52, resets_at: reset_s + 9000 },
        seven_day: { used_percentage: 35, resets_at: reset_s + 3 * 86400 + 3600 },
      },
    }));
    const result = runChild(stdin);
    assert.equal(result.status, 0);
    assert.deepEqual(result.events, []);
    const out = stripAnsi(result.stdout);
    assert.match(out, /5h .* 52% 2h(29|30)m/);
    assert.match(out, /7d .* 35% 3d/);
  });
});

describe('reset cache write', () => {
  it('writes the contract shape', async () => {
    const cache_file = freshCacheFile();
    await runLine(fullSession(), { reset_cache_file: cache_file });
    const cache = JSON.parse(fs.readFileSync(cache_file, 'utf8'));
    assert.equal(typeof cache.fetched_at, 'number');
    assert.deepEqual(Object.keys(cache.data), ['five_hour', 'seven_day']);
    assert.equal(cache.data.five_hour.utilization, 52);
    assert.equal(cache.data.seven_day.utilization, 35);
    assert.match(cache.data.five_hour.resets_at, ISO_RE);
    assert.match(cache.data.seven_day.resets_at, ISO_RE);
    assert.equal(cache.data.five_hour.resets_at, new Date((NOW_S + 9000) * 1000).toISOString());
  });

  it('writes epoch 4102444800 as 2100-01-01T00:00:00.000Z', async () => {
    const cache_file = freshCacheFile();
    await runLine({ rate_limits: { five_hour: { used_percentage: 1, resets_at: 4102444800 } } }, {
      reset_cache_file: cache_file,
    });
    const cache = JSON.parse(fs.readFileSync(cache_file, 'utf8'));
    assert.equal(cache.data.five_hour.resets_at, '2100-01-01T00:00:00.000Z');
  });
});

describe('reset cache round trip through rate-limit.js', () => {
  it('rate-limit.js reads what the status line wrote', async () => {
    await run({ stdin_text: JSON.stringify(fullSession()), now_ms: NOW_MS });
    const cache = readStatuslineCache();
    const on_disk = JSON.parse(fs.readFileSync(process.env.CLAUDE_STATUSLINE_CACHE, 'utf8'));
    assert.deepEqual(cache, on_disk);
    assert.equal(getNextResetIso(), cache.data.five_hour.resets_at);
  });

  it('default path equals the reader default', () => {
    assert.equal(resolveResetCacheFile({}), path.join(os.tmpdir(), 'claude-statusline-usage.json'));
  });
});

describe('reset cache policy', () => {
  const five = { used_percentage: 52, resets_at: NOW_S + 9000 };
  const seven = { used_percentage: 35, resets_at: NOW_S + 86400 };

  async function seed(cache_file) {
    await run({
      stdin_text: JSON.stringify({ rate_limits: { five_hour: five, seven_day: seven } }),
      now_ms: NOW_MS,
      reset_cache_file: cache_file,
    });
  }

  it('keeps the file byte-identical when stdin has no rate_limits', async () => {
    const cache_file = freshCacheFile();
    await seed(cache_file);
    const before_bytes = fs.readFileSync(cache_file);
    await run({ stdin_text: '{}', now_ms: NOW_MS + 1000, reset_cache_file: cache_file });
    assert.ok(before_bytes.equals(fs.readFileSync(cache_file)));
  });

  it('keeps the previous seven_day when only five_hour is on stdin', async () => {
    const cache_file = freshCacheFile();
    await seed(cache_file);
    const newer = { used_percentage: 60, resets_at: NOW_S + 9100 };
    await run({
      stdin_text: JSON.stringify({ rate_limits: { five_hour: newer } }),
      now_ms: NOW_MS + 1000,
      reset_cache_file: cache_file,
    });
    const { data } = JSON.parse(fs.readFileSync(cache_file, 'utf8'));
    assert.equal(data.five_hour.utilization, 60);
    assert.equal(data.seven_day.utilization, 35);
  });

  it('removes a window after its reset', async () => {
    const cache_file = freshCacheFile();
    await seed(cache_file);
    await run({ stdin_text: '{}', now_ms: (NOW_S + 9001) * 1000, reset_cache_file: cache_file });
    const { data } = JSON.parse(fs.readFileSync(cache_file, 'utf8'));
    assert.deepEqual(Object.keys(data), ['seven_day']);
  });

  it('leaves empty data when all windows expired', async () => {
    const cache_file = freshCacheFile();
    await seed(cache_file);
    const later_ms = (NOW_S + 86401) * 1000;
    await run({ stdin_text: '{}', now_ms: later_ms, reset_cache_file: cache_file });
    const cache = JSON.parse(fs.readFileSync(cache_file, 'utf8'));
    assert.deepEqual(cache, { fetched_at: later_ms, data: {} });
    const saved = process.env.CLAUDE_STATUSLINE_CACHE;
    process.env.CLAUDE_STATUSLINE_CACHE = cache_file;
    try {
      assert.equal(getNextResetIso(), null);
    } finally {
      process.env.CLAUDE_STATUSLINE_CACHE = saved;
    }
  });

  it('creates no file when there is nothing to record', async () => {
    const cache_file = freshCacheFile();
    await run({ stdin_text: JSON.stringify({ model: { display_name: 'Opus' } }), now_ms: NOW_MS, reset_cache_file: cache_file });
    assert.equal(fs.existsSync(cache_file), false);
  });

  it('renders but does not write a past window', async () => {
    const cache_file = freshCacheFile();
    const line = await run({
      stdin_text: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 90, resets_at: NOW_S - 60 } } }),
      now_ms: NOW_MS,
      reset_cache_file: cache_file,
    });
    assert.match(stripAnsi(line), /5h .* 90% now/);
    assert.equal(fs.existsSync(cache_file), false);
  });

  it('rewrites a legacy raw-API file in the new shape', async () => {
    const cache_file = freshCacheFile();
    const offset_iso = '2099-01-01T05:00:00+02:00';
    fs.writeFileSync(cache_file, JSON.stringify({
      fetched_at: NOW_MS - 1000,
      data: {
        five_hour: { utilization: 10, resets_at: offset_iso },
        seven_day: { utilization: 20, resets_at: '2099-01-02T00:00:00.123456+00:00' },
        extra_usage: { is_enabled: true },
      },
    }));
    await run({ stdin_text: '{}', now_ms: NOW_MS, reset_cache_file: cache_file });
    const { data } = JSON.parse(fs.readFileSync(cache_file, 'utf8'));
    assert.deepEqual(Object.keys(data), ['five_hour', 'seven_day']);
    assert.equal(data.five_hour.resets_at, '2099-01-01T03:00:00.000Z');
    assert.match(data.seven_day.resets_at, ISO_RE);
  });
});

describe('robustness against missing, malformed and wrong-typed stdin', () => {
  const bad_stdin = ['', '   \n', '{not json', 'null', '42', '"x"', '[]', 'true'];

  for (const stdin of bad_stdin) {
    it(`child exits cleanly on stdin ${JSON.stringify(stdin)}`, () => {
      const result = runChild(stdin);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.doesNotMatch(result.stdout, /\bat .*\.js:\d+/);
      assert.equal(result.stdout, '');
    });
  }

  const reset_s = () => Math.floor(Date.now() / 1000) + 9000;
  const CTX = '│ ctx ████░░░░░░  42%';
  const ctx_only = 'ctx ████░░░░░░  42%';
  const ctx = { context_window: { used_percentage: 42 } };
  // [session, expected stripped line]; the 5h reset suffix depends on wall time
  // in the child, so those cases match with a pattern.
  const wrong_typed = {
    'rate_limits string': [{ rate_limits: 'x', ...ctx }, ctx_only],
    'five_hour number': [{ rate_limits: { five_hour: 5 }, ...ctx }, ctx_only],
    'used_percentage string': [{ rate_limits: { five_hour: { used_percentage: '50', resets_at: reset_s() } }, ...ctx }, ctx_only],
    'resets_at string': [{ rate_limits: { five_hour: { used_percentage: 50, resets_at: '123' } }, ...ctx }, `5h █████░░░░░  50% ${CTX}`],
    // Raw JSON: JSON.stringify would turn Infinity into null, but JSON.parse reads 1e400 as Infinity.
    'resets_at 1e400': ['{"rate_limits":{"five_hour":{"used_percentage":50,"resets_at":1e400}},"context_window":{"used_percentage":42}}', `5h █████░░░░░  50% ${CTX}`],
    'used_percentage 150': [{ rate_limits: { five_hour: { used_percentage: 150, resets_at: reset_s() } }, ...ctx }, /^5h █{10} 150% 2h\d+m │ ctx █{4}░{6}  42%$/],
    'context_window number': [{ context_window: 7, cost: { total_cost_usd: 0.5 } }, '$0.50'],
    'cost string': [{ cost: { total_cost_usd: 'abc' }, ...ctx }, ctx_only],
    'model array': [{ model: [], ...ctx }, ctx_only],
  };

  for (const [name, [session, expected]] of Object.entries(wrong_typed)) {
    it(`child survives ${name} and renders the valid segments`, () => {
      const result = runChild(typeof session === 'string' ? session : JSON.stringify(session));
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.doesNotMatch(result.stdout, /\bat .*\.js:\d+/);
      const line = stripAnsi(result.stdout).trim();
      if (expected instanceof RegExp) assert.match(line, expected);
      else assert.equal(line, expected);
    });
  }

  it('a millisecond or far-future resets_at is not written as an extended-year ISO string', async () => {
    const cache_file = freshCacheFile();
    await run({
      stdin_text: JSON.stringify({ rate_limits: {
        five_hour: { used_percentage: 10, resets_at: (NOW_S + 9000) * 1000 },
        seven_day: { used_percentage: 10, resets_at: 1e300 },
      } }),
      now_ms: NOW_MS,
      reset_cache_file: cache_file,
    });
    const { data } = JSON.parse(fs.readFileSync(cache_file, 'utf8'));
    assert.equal(data.five_hour.resets_at, new Date((NOW_S + 9000) * 1000).toISOString());
    assert.equal(data.seven_day, undefined);
    assert.equal(toIsoString(999999999999999), null);
  });

  it('still renders valid segments next to invalid ones', async () => {
    const line = stripAnsi(await runLine({
      model: [],
      context_window: { used_percentage: 42 },
      cost: { total_cost_usd: 'abc' },
      rate_limits: { five_hour: { used_percentage: '50', resets_at: NOW_S + 9000 } },
    }));
    assert.equal(line, 'ctx ████░░░░░░  42%');
  });

  it('renders a clamped bar for used_percentage 150', async () => {
    const line = stripAnsi(await runLine({
      rate_limits: { five_hour: { used_percentage: 150, resets_at: NOW_S + 9000 } },
    }));
    assert.equal(line, '5h ██████████ 150% 2h30m');
  });

  it('spend_limit alone renders no bars and writes no cache', async () => {
    const cache_file = freshCacheFile();
    const line = await run({
      stdin_text: JSON.stringify({ rate_limits: { spend_limit: { used_percentage: 10, resets_at: NOW_S + 9000 } } }),
      now_ms: NOW_MS,
      reset_cache_file: cache_file,
    });
    assert.equal(line, '');
    assert.equal(fs.existsSync(cache_file), false);
  });

  it('an unwritable cache path does not change the line', async () => {
    const good = await runLine(fullSession());
    const bad_path = path.join(tmp_root, 'no-such-dir', 'nested', 'cache.json');
    const bad = await runLine(fullSession(), { reset_cache_file: bad_path });
    assert.equal(bad, good);
  });
});

// --- Opt-in extra usage ---
const { OAUTH_USAGE, fetchUsage } = require('../statusline/oauth-usage.js');

const EXTRA_PAYLOAD = Object.freeze({
  extra_usage: { is_enabled: true, utilization: 29, used_credits: 1161, monthly_limit: 4000 },
});
const TOKEN = 'filetok';

function writeSwitch(content) {
  const file = path.join(tmp_root, `switch-${++case_counter}.json`);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

function optInRun(session, payload, extra = {}) {
  return runLine(session, Object.assign({
    settings_file: writeSwitch({ extra_usage: true }),
    fetch_usage: async () => payload,
  }, extra));
}

describe('opt-in switch parsing', () => {
  // Factories resolve inside the test, after tmp_root exists.
  const cases = [
    ['missing file', () => path.join(tmp_root, 'absent-switch.json')],
    ['malformed JSON', () => writeSwitch('{nope')],
    ['array', () => writeSwitch('[]')],
    ['string true', () => writeSwitch({ extra_usage: 'true' })],
    ['number 1', () => writeSwitch({ extra_usage: 1 })],
    ['false', () => writeSwitch({ extra_usage: false })],
  ];
  for (const [name, makeSettingsFile] of cases) {
    it(`${name} leaves fetch_usage uncalled`, async () => {
      let calls = 0;
      const settings_file = makeSettingsFile();
      const base = await runLine(fullSession());
      const line = await runLine(fullSession(), {
        settings_file,
        fetch_usage: async () => { calls += 1; return EXTRA_PAYLOAD; },
      });
      assert.equal(calls, 0);
      assert.equal(line, base);
    });
  }

  it('true calls fetch_usage once', async () => {
    let calls = 0;
    await runLine(fullSession(), {
      settings_file: writeSwitch({ extra_usage: true }),
      fetch_usage: async () => { calls += 1; return null; },
    });
    assert.equal(calls, 1);
  });
});

describe('opt-in rendering', () => {
  it('renders the extra usage segment between 7d and ctx', async () => {
    const line = await optInRun(fullSession(), EXTRA_PAYLOAD);
    assert.equal(
      stripAnsi(line),
      'Opus │ 5h █████░░░░░  52% 2h30m │ 7d ████░░░░░░  35% 3d │ +  29% $11.61/$40.00 │ ctx ████░░░░░░  42% │ $0.12',
    );
  });

  it('stdin window wins over the fetched one', async () => {
    const line = await optInRun(fullSession(), {
      five_hour: { utilization: 10, resets_at: new Date(NOW_MS + 3600_000).toISOString() },
    });
    assert.match(stripAnsi(line), /5h █████░░░░░  52% 2h30m/);
  });

  it('fetched windows fill bars when stdin has none', async () => {
    const line = await optInRun({ model: { display_name: 'Opus' } }, {
      five_hour: { utilization: 10, resets_at: new Date(NOW_MS + 3600_000).toISOString() },
      seven_day: { utilization: 20, resets_at: new Date(NOW_MS + 2 * 86400_000).toISOString() },
    });
    assert.equal(stripAnsi(line), 'Opus │ 5h █░░░░░░░░░  10% 1h0m │ 7d ██░░░░░░░░  20% 2d');
  });

  it('stdin one window, fetch both: stdin wins, fetch fills the other', async () => {
    const session = fullSession();
    delete session.rate_limits.seven_day;
    const line = await optInRun(session, {
      five_hour: { utilization: 10, resets_at: new Date(NOW_MS + 3600_000).toISOString() },
      seven_day: { utilization: 20, resets_at: new Date(NOW_MS + 2 * 86400_000).toISOString() },
    });
    assert.equal(
      stripAnsi(line),
      'Opus │ 5h █████░░░░░  52% 2h30m │ 7d ██░░░░░░░░  20% 2d │ ctx ████░░░░░░  42% │ $0.12',
    );
  });

  it('does not render a fetched window past its reset', async () => {
    const line = await optInRun({ model: { display_name: 'Opus' } }, {
      five_hour: { utilization: 10, resets_at: new Date(NOW_MS - 1000).toISOString() },
    });
    assert.equal(stripAnsi(line), 'Opus');
  });

  it('writes uniform ISO strings to the reset cache', async () => {
    const cache_file = freshCacheFile();
    const sooner_s = NOW_S + 3600;
    await optInRun({ model: { display_name: 'Opus' } }, {
      five_hour: { utilization: 10, resets_at: '2099-01-01T05:00:00+00:00' },
      seven_day: { utilization: 20, resets_at: sooner_s },
    }, { reset_cache_file: cache_file });
    const cache = JSON.parse(fs.readFileSync(cache_file, 'utf8'));
    assert.equal(cache.data.five_hour.resets_at, '2099-01-01T05:00:00.000Z');
    assert.equal(cache.data.seven_day.resets_at, new Date(sooner_s * 1000).toISOString());
    for (const key of ['five_hour', 'seven_day']) assert.match(cache.data[key].resets_at, ISO_RE);

    const saved = process.env.CLAUDE_STATUSLINE_CACHE;
    process.env.CLAUDE_STATUSLINE_CACHE = cache_file;
    try {
      assert.equal(getNextResetIso(), new Date(sooner_s * 1000).toISOString());
    } finally {
      process.env.CLAUDE_STATUSLINE_CACHE = saved;
    }
  });
});

describe('opt-in failure isolation', () => {
  const bad_results = [
    ['returns null', async () => null],
    ["returns 'x'", async () => 'x'],
    ['returns extra_usage without credits', async () => ({ extra_usage: { is_enabled: true } })],
    ['returns a bad window', async () => ({ five_hour: 'bad' })],
    ['throws', async () => { throw new Error('boom'); }],
  ];
  for (const [name, fetch_usage] of bad_results) {
    it(`fetch_usage ${name}: line equals the switch-off line`, async () => {
      const off = await runLine(fullSession());
      const on = await runLine(fullSession(), {
        settings_file: writeSwitch({ extra_usage: true }),
        fetch_usage,
      });
      assert.equal(on, off);
    });
  }
});

describe('fetchUsage', () => {
  let home;
  let empty_home;

  before(() => {
    home = path.join(tmp_root, 'fetch-home');
    empty_home = path.join(tmp_root, 'fetch-empty-home');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(empty_home, { recursive: true });
    fs.writeFileSync(
      path.join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: TOKEN } }),
    );
  });

  function okFetch(calls) {
    return async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => EXTRA_PAYLOAD };
    };
  }

  const baseOptions = (extra = {}) => Object.assign({
    cache_file: path.join(tmp_root, `fetch-cache-${++case_counter}.json`),
    platform: 'linux',
  }, extra);

  it('returns the payload, writes the cache and sends the headers', async () => {
    const calls = [];
    const options = baseOptions({ home_dir: home, fetch_impl: okFetch(calls) });
    const data = await fetchUsage(options);
    assert.deepEqual(data, EXTRA_PAYLOAD);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, OAUTH_USAGE.api_url);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].init.headers['anthropic-beta'], OAUTH_USAGE.beta_header);
    const cache_text = fs.readFileSync(options.cache_file, 'utf8');
    assert.deepEqual(JSON.parse(cache_text).data, EXTRA_PAYLOAD);
    assert.equal(cache_text.includes(TOKEN), false);
  });

  it('serves a second call inside the TTL without credentials or fetch', async () => {
    const calls = [];
    const options = baseOptions({ home_dir: home, fetch_impl: okFetch(calls), now_ms: 1_000_000 });
    await fetchUsage(options);
    const second = await fetchUsage(Object.assign({}, options, {
      home_dir: empty_home,
      now_ms: 1_000_000 + OAUTH_USAGE.cache_ttl_ms - 1,
    }));
    assert.deepEqual(second, EXTRA_PAYLOAD);
    assert.equal(calls.length, 1);
  });

  it('returns null for an empty home on linux without fetching', async () => {
    const calls = [];
    const data = await fetchUsage(baseOptions({ home_dir: empty_home, fetch_impl: okFetch(calls) }));
    assert.equal(data, null);
    assert.equal(calls.length, 0);
  });

  it('uses the keychain token on darwin', async () => {
    const calls = [];
    const data = await fetchUsage(baseOptions({
      home_dir: empty_home,
      platform: 'darwin',
      exec_sync: () => JSON.stringify({ claudeAiOauth: { accessToken: 'keytok' } }),
      fetch_impl: okFetch(calls),
    }));
    assert.deepEqual(data, EXTRA_PAYLOAD);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer keytok');
  });

  it('returns null on a rejected fetch without a cache', async () => {
    const data = await fetchUsage(baseOptions({
      home_dir: home,
      fetch_impl: async () => { throw new Error('network'); },
    }));
    assert.equal(data, null);
  });

  it('returns null, not stale data, on a rejected fetch with an expired cache', async () => {
    const options = baseOptions({ home_dir: home, fetch_impl: okFetch([]), now_ms: 1_000_000 });
    await fetchUsage(options);
    const data = await fetchUsage(Object.assign({}, options, {
      now_ms: 1_000_000 + OAUTH_USAGE.cache_ttl_ms + 1,
      fetch_impl: async () => { throw new Error('network'); },
    }));
    assert.equal(data, null);
  });

  it('run() equals the switch-off line on a network error with an existing fetch cache', async () => {
    const options = baseOptions({ home_dir: home, fetch_impl: okFetch([]), now_ms: NOW_MS - 120_000 });
    await fetchUsage(options);
    const off = await runLine(fullSession());
    const on = await runLine(fullSession(), {
      settings_file: writeSwitch({ extra_usage: true }),
      fetch_usage: (call) => fetchUsage(Object.assign({}, options, call, {
        fetch_impl: async () => { throw new Error('network'); },
      })),
    });
    assert.equal(on, off);
  });

  it('caches a failed lookup so repeated renders do not refetch', async () => {
    let calls = 0;
    const options = baseOptions({
      home_dir: home,
      now_ms: 1_000_000,
      fetch_impl: async () => { calls += 1; return { ok: false, json: async () => ({}) }; },
    });
    await fetchUsage(options);
    await fetchUsage(Object.assign({}, options, { now_ms: 1_000_300 }));
    assert.equal(calls, 1);
    await fetchUsage(Object.assign({}, options, { now_ms: 1_000_000 + OAUTH_USAGE.failure_cache_ttl_ms + 1 }));
    assert.equal(calls, 2);
  });

  it('treats a cache with a future fetched_at as expired', async () => {
    const calls = [];
    const options = baseOptions({ home_dir: home, fetch_impl: okFetch(calls), now_ms: 1_000_000 });
    fs.writeFileSync(options.cache_file, JSON.stringify({ fetched_at: 9e15, data: { five_hour: { utilization: 1 } } }));
    const data = await fetchUsage(options);
    assert.deepEqual(data, EXTRA_PAYLOAD);
    assert.equal(calls.length, 1);
  });

  it('writes the cache with mode 0600 and replaces, not follows, a symlink', { skip: process.platform === 'win32' }, async () => {
    const options = baseOptions({ home_dir: home, fetch_impl: okFetch([]) });
    const victim = path.join(tmp_root, `victim-${case_counter}.txt`);
    fs.writeFileSync(victim, 'untouched');
    fs.symlinkSync(victim, options.cache_file);
    await fetchUsage(options);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
    assert.equal(fs.lstatSync(options.cache_file).isSymbolicLink(), false);
    assert.equal(fs.statSync(options.cache_file).mode & 0o777, 0o600);
  });

  it('works when called without a cache location', async () => {
    const data = await fetchUsage({ home_dir: empty_home, platform: 'linux', cache_file: path.join(tmp_root, 'noarg-cache.json') });
    assert.equal(data, null);
  });

  it('returns null on a non-ok response', async () => {
    const data = await fetchUsage(baseOptions({
      home_dir: home,
      fetch_impl: async () => ({ ok: false, json: async () => ({}) }),
    }));
    assert.equal(data, null);
  });
});

describe('opt-in child process positive control', () => {
  it('reads credentials and fetches when the switch is on', () => {
    const switch_file = path.join(state_dir, 'statusline.json');
    fs.writeFileSync(switch_file, JSON.stringify({ extra_usage: true }));
    try {
      const result = runChild(JSON.stringify(fullSession()), {
        STATUSLINE_PROBE_FETCH_BODY: JSON.stringify(EXTRA_PAYLOAD),
      });
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.ok(result.events.includes('credentials-read'));
      assert.ok(result.events.includes('fetch'));
      assert.ok(stripAnsi(result.stdout).includes('$11.61/$40.00'));
    } finally {
      fs.rmSync(switch_file, { force: true });
      fs.rmSync(path.join(state_dir, OAUTH_USAGE.cache_file_name), { force: true });
    }
  });

  it('the negative probe still logs nothing with the switch off', () => {
    const result = runChild(JSON.stringify(fullSession()));
    assert.deepEqual(result.events, []);
  });
});

describe('default path static purity', () => {
  for (const file of ['statusline.js', 'reset-cache.js']) {
    it(`${file} requires no process, network or credential modules`, () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'statusline', file), 'utf8');
      assert.doesNotMatch(source, /require\(\s*['"](?:node:)?(?:child_process|http|https|net|tls|dns)['"]/);
      assert.doesNotMatch(source, /\.credentials\.json/);
    });
  }
});

describe('trusted read of the cache files', () => {
  const { readTrustedJson } = require('../statusline/reset-cache.js');
  const RESET_CACHE_MODULE = path.join(REPO_ROOT, 'statusline', 'reset-cache.js');
  const no_fifo = process.platform === 'win32';

  it('parses a regular file owned by the current user', () => {
    const file = path.join(tmp_root, 'trusted-own.json');
    fs.writeFileSync(file, JSON.stringify({ data: { ok: true } }));
    assert.deepEqual(readTrustedJson(file), { data: { ok: true } });
  });

  it('treats a directory at the path as absent', () => {
    const dir = path.join(tmp_root, 'trusted-dir.json');
    fs.mkdirSync(dir);
    assert.equal(readTrustedJson(dir), null);
  });

  it('treats a file owned by another user as absent', { skip: typeof process.getuid !== 'function' }, () => {
    const file = path.join(tmp_root, 'trusted-foreign.json');
    fs.writeFileSync(file, JSON.stringify({ data: { planted: true } }));
    const real_getuid = process.getuid;
    process.getuid = () => real_getuid() + 1;
    try {
      assert.equal(readTrustedJson(file), null);
    } finally {
      process.getuid = real_getuid;
    }
  });

  it('returns at once for a FIFO instead of blocking', { skip: no_fifo }, () => {
    const fifo = path.join(tmp_root, 'trusted-fifo.json');
    spawnSync('mkfifo', [fifo]);
    // In a child with a timeout: a blocking open would hang the test process.
    const result = spawnSync(process.execPath, ['-e',
      `const { readTrustedJson } = require(${JSON.stringify(RESET_CACHE_MODULE)});` +
      `process.stdout.write(JSON.stringify(readTrustedJson(${JSON.stringify(fifo)})));`,
    ], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.signal, null, 'the read must not block on a FIFO');
    assert.equal(result.stdout, 'null');
  });

  it('renders the line when a FIFO sits at the reset cache path', { skip: no_fifo }, () => {
    const fifo = path.join(tmp_root, 'reset-fifo.json');
    spawnSync('mkfifo', [fifo]);
    const result = spawnSync(process.execPath, [SCRIPT], {
      input: JSON.stringify(fullSession()),
      encoding: 'utf8',
      timeout: 5000,
      env: Object.assign({}, process.env, {
        HOME: path.join(tmp_root, 'home'),
        CLAUDE_WORKFLOW_STATE_DIR: state_dir,
        CLAUDE_STATUSLINE_CACHE: fifo,
      }),
    });
    assert.equal(result.signal, null, 'the status line must not hang');
    assert.equal(result.status, 0);
    assert.match(stripAnsi(result.stdout), /5h .* │ 7d /);
  });
});
